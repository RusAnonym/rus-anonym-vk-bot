import utils from "rus-anonym-utils";
import { UserCommand } from "../../../utils/lib/commands/core";

new UserCommand(/(?:^!выбери\s)(.*)(?:\sили\s)(.*)$/i, async function (
	message,
) {
	return await message.reply(
		`Я выбираю ${
			message.state.args[utils.number.getRandomIntInclusive(0, 1) + 1]
		}`,
	);
});
