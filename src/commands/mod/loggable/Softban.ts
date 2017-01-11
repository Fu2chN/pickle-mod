import { Command, Message } from 'yamdbf';
import { User } from 'discord.js';
import ModBot from '../../../lib/ModBot';

export default class Softban extends Command<ModBot>
{
	public constructor(bot: ModBot)
	{
		super(bot, {
			name: 'softban',
			aliases: [],
			description: 'Softban a user',
			usage: '<prefix>softban <@user> <...reason>',
			extraHelp: '',
			argOpts: { stringArgs: true },
			group: 'mod',
			guildOnly: true
		});
	}

	public async action(message: Message, args: Array<string | number>, mentions: User[], original: string): Promise<any>
	{
		if (!this.bot.mod.canCallModCommand(message)) return;
		if (!mentions[0]) return message.channel.send('You must mention a user to softban.');
		const user: User = mentions[0];

		if (user.id === message.author.id)
			return message.channel.send(`I don't think you want to softban yourself.`);

		const modRole: string = message.guild.storage.getSetting('modrole');
		if (message.guild.member(user.id).roles.has(modRole) || user.id === message.guild.ownerID || user.bot)
			return message.channel.send('You may not use this command on that user.');

		const reason: string = args.join(' ').trim();
		if (!reason) return message.channel.send('You must provide a reason to softban that user.');

		const kicking: Message = <Message> await message.channel.send(
			`Softbanning ${user.username}#${user.discriminator}... *(Waiting for unban)*`);

		user.send(`You have been softbanned from ${message.guild.name}\n\n**Reason:** ${
			reason}\n\nA softban is a kick that uses ban+unban to remove your messages from `
			+ `the server. You may rejoin momentarily.`);

		this.bot.mod.actions.softban(user, message.guild);
		let cases: Message[] = <Message[]> await this.bot.mod.logger.awaitCase(message.guild, user, 'Softban');
		this.bot.mod.logger.mergeSoftban(message.guild, cases[0], cases[1], message.author, reason);

		return kicking.edit(`Successfully softbanned ${user.username}#${user.discriminator}`);
	}
}
