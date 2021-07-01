import moment from "moment";
import utils from "rus-anonym-utils";
import {
	ContextDefaultState,
	getRandomId,
	MessageContext,
	MessageFlagsContext,
	createCollectIterator,
} from "vk-io";
import { ExtractDoc } from "ts-mongoose";

import VK from "../../VK/core";
import InternalUtils from "../core";
import DB from "../../DB/core";
import { FriendsUserXtrLists } from "vk-io/lib/api/schemas/objects";

interface BirthdayUser {
	name: string;
	surname: string;
	id: number;
}

export default class UtilsUser {
	public async processDeletedMessage(
		event: MessageFlagsContext<ContextDefaultState>,
	): Promise<void> {
		const deletedMessageData = await DB.user.models.message.findOne({
			id: event.id,
		});

		if (!deletedMessageData) {
			InternalUtils.logger.send(
				`Удалено сообщение #${event.id}, но в БД нет данных об этом сообщении(`,
				"error",
			);
			return;
		}

		if (deletedMessageData.isOutbox) {
			return;
		}

		const deletedMessageText =
			deletedMessageData.data[deletedMessageData.data.length - 1].text;

		const logsChatId =
			deletedMessageData.peerType === "chat"
				? DB.config.VK.group.logs.conversations.conversations
				: DB.config.VK.group.logs.conversations.messages;

		const uploadedAttachments = await this.uploadAttachments(
			deletedMessageData.data[deletedMessageData.data.length - 1].attachments,
			logsChatId,
		);

		let attachmentsText = "";

		for (let i = 0; i < uploadedAttachments.length; i++) {
			attachmentsText += `\n${Number(i) + 1}. ${uploadedAttachments[i].type}`;
		}

		if (deletedMessageData.senderId > 1) {
			const userData = await this.getUserData(deletedMessageData.senderId);

			VK.group.getVK().api.messages.send({
				message: `Удалено сообщение #id${event.id} от ${moment(
					deletedMessageData.created,
				).format("HH:mm:ss, DD.MM.YYYY")}
Отправитель: @id${deletedMessageData.senderId} (${userData.info.name} ${
					userData.info.surname
				})
#from_id${deletedMessageData.senderId}

Текст сообщения: ${deletedMessageText || "Отсутствует"}

Прикрепления: ${attachmentsText || "Отсутствуют"}`,
				chat_id: logsChatId,
				random_id: getRandomId(),
				attachment: uploadedAttachments.map((x) => x.link),
			});
		} else {
			VK.group.getVK().api.messages.send({
				message: `Удалено сообщение #id${event.id} от ${moment(
					deletedMessageData.created,
				).format("HH:mm:ss, DD.MM.YYYY")}
Отправитель: @club${deletedMessageData.senderId}
#from_id${deletedMessageData.senderId}

Текст сообщения: ${deletedMessageText || "Отсутствует"}

Прикрепления: ${attachmentsText || "Отсутствуют"}`,
				chat_id: logsChatId,
				random_id: getRandomId(),
				attachment: uploadedAttachments.map((x) => x.link),
			});
		}
	}

	public async processEditedMessage(
		message: MessageContext,
		oldMessage: ExtractDoc<typeof DB.user.schemes.message>,
	): Promise<void> {
		const logsChatId =
			oldMessage.peerType === "chat"
				? DB.config.VK.group.logs.conversations.conversations
				: DB.config.VK.group.logs.conversations.messages;
		const uploadedAttachments = await this.uploadAttachments(
			oldMessage.data[oldMessage.data.length - 2].attachments,
			logsChatId,
		);
		let attachmentsText = "";
		uploadedAttachments.map((attachment, index) => {
			attachmentsText += `\n${index + 1}. ${attachment.type}`;
		});

		if (oldMessage.senderId > 0) {
			const userData = await this.getUserData(oldMessage.senderId);

			VK.group.getVK().api.messages.send({
				message: `Отредактировано сообщение #${message.id}
						https://vk.com/im?sel=${
							message.isChat ? `c${message.chatId}` : message.peerId
						}&msgid=${message.id} от ${moment(oldMessage.updated).format(
					"HH:mm:ss, DD.MM.YYYY",
				)}
Отправитель: @id${userData.id} (${userData.info.name} ${userData.info.surname})
						Предыдущие данные:
						Текст: ${oldMessage.data[oldMessage.data.length - 2].text || "Отсутствует"}
												Прикрепления: ${attachmentsText || "Отсутсвуют"}`,
				chat_id: logsChatId,
				random_id: getRandomId(),
				attachment: uploadedAttachments.map((x) => x.link),
			});
		} else {
			VK.group.getVK().api.messages.send({
				message: `Отредактировано сообщение #${message.id}
						https://vk.com/im?sel=${
							message.isChat ? `c${message.chatId}` : message.peerId
						}&msgid=${message.id} от ${moment(oldMessage.updated).format(
					"HH:mm:ss, DD.MM.YYYY",
				)}
Отправитель: @club${-oldMessage.senderId}
						Предыдущие данные:
						Текст: ${oldMessage.data[oldMessage.data.length - 2].text || "Отсутствует"}
												Прикрепления: ${attachmentsText || "Отсутсвуют"}`,
				chat_id: logsChatId,
				random_id: getRandomId(),
				attachment: uploadedAttachments.map((x) => x.link),
			});
		}
	}

	public async saveMessage(message: MessageContext): Promise<void> {
		switch (message.subTypes[0]) {
			case "message_new": {
				await new DB.user.models.message({
					id: message.id,
					conversationMessageId: message.conversationMessageId,
					peerId: message.peerId,
					peerType: message.peerType,
					senderId:
						message.isOutbox === true ? DB.config.VK.user.id : message.senderId,
					senderType: message.senderType,
					created: new Date(message.createdAt * 1000),
					updated: new Date(message.createdAt * 1000),
					isOutbox: message.isOutbox,
					events: [
						{
							updatedAt: message.updatedAt || 0,
							text: message.text || "",
							attachments: message.attachments.map((x) => {
								return x.toString();
							}),
							type: message.type,
							subTypes: message.subTypes || [],
							hasReply: message.hasReplyMessage,
							hasForwards: message.hasForwards,
						},
					],
					data: [
						(
							await VK.user
								.getVK()
								.api.messages.getById({ message_ids: message.id })
						).items[0],
					],
				}).save();
				break;
			}
			case "message_edit": {
				const oldMessageData = await DB.user.models.message.findOne({
					id: message.id,
				});
				if (oldMessageData) {
					oldMessageData.events.push({
						updatedAt: message.updatedAt || 0,
						text: message.text || "",
						attachments: message.attachments.map((x) => {
							return x.toString();
						}),
						type: message.type,
						subTypes: message.subTypes || [],
						hasReply: message.hasReplyMessage,
						hasForwards: message.hasForwards,
					});
					const newMessageData = (
						await VK.user
							.getVK()
							.api.messages.getById({ message_ids: message.id })
					).items[0];
					oldMessageData.data.push(newMessageData);
					if (message.updatedAt) {
						oldMessageData.updated = new Date(message.updatedAt * 1000);
					}
					await oldMessageData.save();

					const isTranscriptAudioMessage: boolean =
						(newMessageData.attachments &&
							newMessageData.attachments[0] &&
							newMessageData.attachments[0].audio_message &&
							newMessageData.attachments[0].audio_message.transcript_state ===
								"done") ||
						false;

					if (message.isInbox && !isTranscriptAudioMessage) {
						InternalUtils.user.processEditedMessage(message, oldMessageData);
					}
				}

				break;
			}
			default: {
				break;
			}
		}

		if (!message.isGroup) {
			const fixedSenderId = message.isOutbox
				? DB.config.VK.user.id
				: message.senderId;
			const userData = await this.getUserData(fixedSenderId);
			if (message.isChat === false) {
				userData.personalMessages.push(message.id);
			} else {
				userData.messages.push(message.id);
			}
			userData.updateDate = new Date();
			await userData.save();
		}

		if (message.isChat && message.chatId) {
			const chatData = await DB.user.models.chat.findOne({
				id: message.chatId,
			});
			if (!chatData) {
				const newChatData = new DB.user.models.chat({
					id: message.chatId,
					messages: [message.id],
					updateDate: new Date(),
					regDate: new Date(),
				});
				await newChatData.save();
			} else {
				chatData.messages.push(message.id);
				chatData.updateDate = new Date();
				await chatData.save();
			}
		}
	}

	public async getUserData(
		id: number,
	): Promise<ExtractDoc<typeof DB.user.schemes.user>> {
		const userData = await DB.user.models.user.findOne({
			id,
		});
		if (!userData) {
			const [VK_USER_DATA] = await VK.group
				.getVK()
				.api.users.get({ user_id: id, fields: ["status", "last_seen", "sex"] });
			const newUserData = new DB.user.models.user({
				id,
				info: {
					name: VK_USER_DATA.first_name,
					surname: VK_USER_DATA.last_name,
					gender: VK_USER_DATA.sex || 0,
					last_seen:
						VK_USER_DATA.last_seen && VK_USER_DATA.last_seen.time
							? {
									date: new Date(VK_USER_DATA.last_seen.time * 1000),
									isOnline: false,
							  }
							: null,
					extends: {
						name_nom: VK_USER_DATA.first_name_nom,
						name_gen: VK_USER_DATA.first_name_gen,
						name_dat: VK_USER_DATA.first_name_dat,
						name_acc: VK_USER_DATA.first_name_acc,
						name_ins: VK_USER_DATA.first_name_ins,
						name_abl: VK_USER_DATA.first_name_abl,
						surname_nom: VK_USER_DATA.last_name_nom,
						surname_gen: VK_USER_DATA.last_name_gen,
						surname_dat: VK_USER_DATA.last_name_dat,
						surname_acc: VK_USER_DATA.last_name_acc,
						surname_ins: VK_USER_DATA.last_name_ins,
						surname_abl: VK_USER_DATA.last_name_abl,
						domain: VK_USER_DATA.domain,
						photo_max_orig: VK_USER_DATA.photo_max_orig,
						status: VK_USER_DATA.status,
						counters: {
							albums: VK_USER_DATA.counters?.albums,
							audios: VK_USER_DATA.counters?.audios,
							friends: VK_USER_DATA.counters?.friends,
							pages: VK_USER_DATA.counters?.pages,
							subscriptions: VK_USER_DATA.counters?.subscriptions,
							videos: VK_USER_DATA.counters?.videos,
							posts: VK_USER_DATA.counters?.posts,
						},
					},
				},
				messages: [],
				personalMessages: [],
				updateDate: new Date(),
				regDate: new Date(),
			});
			await newUserData.save();
			return newUserData;
		}
		return userData;
	}

	public async getFriendsBirthday(date: Date): Promise<BirthdayUser[]> {
		const birthdays: BirthdayUser[] = [];
		const validDate = moment(date).format("D.M");

		const iterator = createCollectIterator<FriendsUserXtrLists>({
			api: VK.user.getVK().api,
			method: "friends.get",
			params: {
				fields: [`bdate`],
			},
			countPerRequest: 5000,
		});

		for await (const chunk of iterator) {
			for (const user of chunk.items) {
				if (user.bdate) {
					if (moment(user.bdate, "D.M.YYYY").format("D.M") === validDate) {
						birthdays.push({
							id: user.id,
							name: user.first_name,
							surname: user.last_name,
						});
					}
				}
			}
		}

		return birthdays;
	}

	private async uploadAttachments(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		attachments: any[],
		chat: number,
	): Promise<
		{
			link: string;
			type: string;
		}[]
	> {
		const response: {
			link: string;
			type: string;
		}[] = [];
		for (const attachment of attachments) {
			switch (attachment.type) {
				case "story": {
					const story = attachment.story;
					if (story.type === "photo") {
						story.photo.sizes.sort(
							(
								a: { width: number; height: number },
								b: { width: number; height: number },
							) => {
								if (a.width > b.width || a.height > b.height) {
									return -1;
								} else if (a.width < b.width || a.height < b.height) {
									return 1;
								} else {
									return 0;
								}
							},
						);

						const uploadedStory = await VK.group.getVK().upload.messagePhoto({
							peer_id: 2e9 + chat,
							source: {
								value: story.photo.sizes[0].url,
							},
						});

						response.push({
							type: `История из фото ${story.is_one_time ? "(временная)" : ""}`,
							link: uploadedStory.toString(),
						});
					}

					if (story.type === "video") {
						const resolutionKeys = Object.keys(story.video.files);
						const resolutionArray = resolutionKeys.map((x) =>
							Number(x.split("_")[1]),
						);
						const maxResolution = utils.array.number.max(resolutionArray);

						const uploadedStory = await VK.group
							.getVK()
							.upload.messageDocument({
								peer_id: 2e9 + chat,
								source: {
									value:
										story.video.files[
											resolutionKeys[resolutionArray.indexOf(maxResolution)]
										],
									contentType: "video/mp4",
									filename: "video.mp4",
								},
							});

						response.push({
							type: `История из видео ${
								story.is_one_time ? "(временная)" : ""
							}`,
							link: uploadedStory.toString(),
						});
					}
					break;
				}
				case "photo": {
					const photo = attachment.photo;
					photo.sizes.sort(
						(
							a: { width: number; height: number },
							b: { width: number; height: number },
						) => {
							if (a.width > b.width || a.height > b.height) {
								return -1;
							} else if (a.width < b.width || a.height < b.height) {
								return 1;
							} else {
								return 0;
							}
						},
					);
					const maxResolutionPhoto = photo.sizes[0];

					const uploadedPhoto = await VK.group.getVK().upload.messagePhoto({
						peer_id: 2e9 + chat,
						source: {
							value: maxResolutionPhoto.url,
						},
					});

					response.push({
						type: `Фотография (${maxResolutionPhoto.width} x ${maxResolutionPhoto.height})`,
						link: uploadedPhoto.toString(),
					});
					break;
				}
				case "video": {
					const video = attachment.video;

					const uploadedVideo = await VK.group.getVK().upload.messageDocument({
						peer_id: 2e9 + chat,
						source: {
							value: video.files.src,
							filename: video.title,
						},
					});

					response.push({
						type: "Видео",
						link: uploadedVideo.toString(),
					});

					break;
				}
				case "audio": {
					const audio = attachment.audio;

					response.push({
						type: "Аудиозапись",
						link: `audio${audio.owner_id}_${audio.id}_${audio.access_key}`,
					});
					break;
				}
				case "doc": {
					const doc = attachment.doc;

					const uploadedDoc = await VK.group.getVK().upload.messageDocument({
						peer_id: 2e9 + chat,
						source: {
							value: doc.url,
							filename: doc.title,
						},
					});

					response.push({
						type: "Документ",
						link: uploadedDoc.toString(),
					});
					break;
				}
				default: {
					break;
				}
			}
		}

		return response;
	}
}
