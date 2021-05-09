import { ModernMessageContext } from "./../../../utils/lib/command";

import InternalUtils from "../../../utils/core";
import DB from "../../../DB/core";
import VK from "../../../VK/core";

async function handler(message: ModernMessageContext): Promise<void> {
	DB.saveMessage(message).catch((err) => {
		console.log(err);
		InternalUtils.logger.send(
			`Error on save message #${message.id}\n
https://vk.com/im?sel=${
				message.isChat ? `c${message.chatId}` : message.peerId
			}&msgid=${message.id}`,
			"error",
		);
	});
	if (message.isOutbox && message.text) {
		const selectedCommand = InternalUtils.commands.find((command) =>
			command.check(message.text as string),
		);

		if (selectedCommand) {
			const TempVK = VK.user.getVK();
			message.args = selectedCommand.regexp.exec(
				message.text,
			) as RegExpExecArray;
			await selectedCommand.process(message, TempVK).catch(() => {
				InternalUtils.logger.send("Error on execute command", "error");
			});
		}
	}
}

export default handler;
