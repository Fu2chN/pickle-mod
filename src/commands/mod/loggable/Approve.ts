import { Command, ClientStorage, Message } from 'yamdbf';
import { User } from 'discord.js';
import { ModClient } from '../../../lib/ModClient';

export default class extends Command<ModClient>
{
	public constructor()
	{
		super({
			name: 'approve',
			desc: 'Approve an appeal',
			usage: '<prefix>approve <id>',
			group: 'mod',
			guildOnly: true
		});
	}

	public async action(message: Message, args: string[]): Promise<any>
	{
		if (!this.client.mod.canCallModCommand(message))
			return this.client.mod.sendModError(message);

		const appealsChannel: string = await message.guild.storage.settings.get('appeals');
		if (message.channel.id !== appealsChannel)
			return message.channel.send('Approve command may only be run in the appeals channel.');

		message.delete();
		const id: string = <string> args[0];
		if (!id) return message.channel.send('You must provide an appeal ID to approve.')
			.then((res: Message) => res.delete(5e3));

		const storage: ClientStorage = this.client.storage;
		const appeal: string = (await storage.get('activeAppeals'))[id];
		if (!appeal) return message.channel.send('Could not find an appeal with that ID.')
			.then((res: Message) => res.delete(5e3));

		const unbanCase: Message = <Message> await this.client.mod.logs.awaitCase(message.guild, id, 'Unban');
		this.client.mod.logs.editCase(message.guild, unbanCase, message.author, 'Approved appeal');
		const user: User = await this.client.fetchUser(id);

		message.channel.send(`Approved appeal \`${id}\`. Unbanned ${user.tag}`)
			.then((res: Message) => res.delete(5e3));
	}
}
