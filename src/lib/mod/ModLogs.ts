import { TextChannel, Guild, Collection, User, RichEmbed, MessageEmbed, MessageCollector, GuildMember } from 'discord.js';
import { GuildStorage, Message } from 'yamdbf';
import { CaseTypeColors } from '../Util';
import { ModClient } from '../ModClient';

/**
 * Contains methods for creating, managing, and fetching moderation logs
 */
export class ModLogs
{
	private _client: ModClient;

	public constructor(client: ModClient)
	{
		this._client = client;
	}

	/**
	 * Post the moderation case to the mod-logs channel
	 */
	public async logCase(user: User, guild: Guild, type: CaseType, reason: string, issuer: User, duration?: string): Promise<Message>
	{
		if (!await this._client.mod.hasLoggingChannel(guild)) return null;
		const storage: GuildStorage = this._client.storage.guilds.get(guild.id);
		let caseNum: number = await storage.settings.get('cases') || 0;
		await storage.settings.set('cases', ++caseNum);

		const embed: RichEmbed = new RichEmbed()
			.setColor(CaseTypeColors[type])
			.setAuthor(issuer.tag, issuer.avatarURL)
			.setDescription(`**Member:** ${user.tag} (${user.id})\n`
				+ `**Action:** ${type}\n`
				+ `${duration ? `**Length:** ${duration}\n` : ''}`
				+ `**Reason:** ${reason}`)
			.setFooter(`Case ${caseNum}`)
			.setTimestamp();

		return <Promise<Message>> (<TextChannel> guild.channels
			.get(await storage.settings.get('modlogs'))).send({ embed });
	}

	/**
	 * Find the specified logged case message
	 */
	public async findCase(guild: Guild, loggedCase: int): Promise<Message>
	{
		const messages: Collection<string, Message> = await (<TextChannel> guild.channels
			.get(await this._client.storage.guilds.get(guild.id).settings.get('modlogs')))
			.fetchMessages({ limit: 100 });

		const foundCase: Message = messages.find((msg: Message) =>
			msg.embeds.length > 0 ? msg.embeds[0].footer.text === `Case ${loggedCase}` : false);

		return foundCase || null;
	}

	/**
	 * Edit a logged moderation case to provide or edit a reason.
	 * Only works if the editor is the original issuer
	 */
	public async editCase(guild: Guild, loggedCase: int | Message, issuer: User, reason?: string, duration?: string): Promise<Message>
	{
		let caseMessage: Message;
		if (typeof loggedCase !== 'number') caseMessage = <Message> loggedCase;
		else caseMessage = await this.findCase(guild, <int> loggedCase);
		if (!caseMessage) return null;

		let messageEmbed: MessageEmbed = caseMessage.embeds[0];
		if (messageEmbed.author.name !== issuer.tag
			&& messageEmbed.author.name !== this._client.user.tag
			&& !(await guild.fetchMember(issuer)).permissions.has('MANAGE_GUILD'))
			return null;

		const durationRegex: RegExp = /\*\*Length:\*\* (.+)*/;
		if (!durationRegex.test(messageEmbed.description) && duration)
			messageEmbed.description = messageEmbed.description
				.replace(/(\*\*Action:\*\* Mute)/, `$1\n${`**Length:** ${duration}`}`);

		const embed: RichEmbed = new RichEmbed()
			.setColor(messageEmbed.color)
			.setAuthor(issuer.tag, issuer.avatarURL);

		if (reason) messageEmbed.description = messageEmbed.description
			.replace(/\*\*Reason:\*\* [\s\S]+/, `**Reason:** ${reason}`);

		if (duration) messageEmbed.description = messageEmbed.description
			.replace(/\*\*Length:\*\* (.+)*/, `**Length:** ${duration}`);

		embed.setDescription(messageEmbed.description)
			.setFooter(messageEmbed.footer.text);

		if (duration) embed.setTimestamp(new Date());
		else embed.setTimestamp(new Date(messageEmbed.createdTimestamp));

		return caseMessage.edit('', { embed });
	}

	/**
	 * Merge two cases (ban and unban) together with a new reason
	 */
	public async mergeSoftban(guild: Guild, ban: int | Message, unban: int | Message, issuer: User, reason: string): Promise<Message>
	{
		let banCaseMessage: Message;
		if (typeof ban !== 'number') banCaseMessage = <Message> ban;
		else banCaseMessage = await this.findCase(guild, <int> ban);
		if (!banCaseMessage) return null;

		const banMessageEmbed: MessageEmbed = banCaseMessage.embeds[0];
		if (banMessageEmbed.author.name !== this._client.user.tag
			&& banMessageEmbed.author.name !== issuer.tag) return null;

		let unbanCaseMessage: Message;
		if (typeof unban !== 'number') unbanCaseMessage = <Message> unban;
		else unbanCaseMessage = await this.findCase(guild, <int> unban);
		if (!unbanCaseMessage) return null;

		const embed: RichEmbed = new RichEmbed()
			.setColor(CaseTypeColors.Softban)
			.setAuthor(issuer.tag, issuer.avatarURL)
			.setDescription(banMessageEmbed.description
				.replace(/\*\*Action:\*\* .+/, `**Action:** Softban`)
				.replace(/\*\*Reason:\*\* .+/, `**Reason:** ${reason}`))
			.setFooter(banMessageEmbed.footer.text)
			.setTimestamp(new Date(banMessageEmbed.createdTimestamp));

		const storage: GuildStorage = this._client.storage.guilds.get(guild.id);
		await storage.settings.set('cases', await storage.settings.get('cases') - 1);
		return banCaseMessage.edit('', { embed }).then(() => unbanCaseMessage.delete());
	}

	/**
	 * Return a promise that resolves with a logged moderation
	 * case for a mute
	 */
	public async awaitMuteCase(guild: Guild, member: GuildMember): Promise<Message>
	{
		return new Promise<Message>(async (resolve, reject) =>
		{
			const logs: TextChannel = <TextChannel> guild.channels.get(
				await this._client.storage.guilds.get(guild.id).settings.get('modlogs'));
			const memberIDRegex: RegExp = /\*\*Member:\*\* .+#\d{4} \((\d+)\)/;
			const actionRegex: RegExp = /\*\*Action:\*\* (Mute)/;

			const collector: MessageCollector = logs.createCollector((m: Message) => m.author.id === this._client.user.id
				&& (m.embeds[0] && m.embeds[0].description.match(memberIDRegex)[1] === member.id), { time: 60e3 });

			let found: Message;
			collector.on('end', () => resolve(found));

			collector.on(<any> 'message', (message: Message) =>
			{
				if (/Mute/.test(message.embeds[0].description.match(actionRegex)[1])) found = message;
				if (found) collector.stop('found');
			});

			try { await this._client.mod.actions.mute(member, guild); }
			catch (err) { reject(err.toString()); }
		});
	}

	/**
	 * Set up a message collector, ban/unban/softban, and resolve
	 * with the collected case messages. Reason should be given
	 * for bans and softbans for audit logs
	 */
	public awaitCase(
		guild: Guild,
		user: User | string,
		type: 'Ban' | 'Unban' | 'Softban',
		reason?: string): Promise<Message | Message[]>
	{
		return new Promise(async resolve =>
		{
			if (typeof user === 'string') user = await this._client.fetchUser(user);
			const logs: TextChannel = <TextChannel> guild.channels.get(
				await this._client.storage.guilds.get(guild.id).settings.get('modlogs'));
			const memberIDRegex: RegExp = /\*\*Member:\*\* .+#\d{4} \((\d+)\)/;
			const actionRegex: RegExp = /\*\*Action:\*\* (Ban|Unban|Softban)/;

			const collector: MessageCollector = logs.createCollector((m: Message) => m.author.id === this._client.user.id
				&& (m.embeds[0] && m.embeds[0].description.match(memberIDRegex)[1] === (<User> user).id), { time: 60e3 });

			let found: Message | Message[];
			collector.on('end', () => resolve(found));

			switch (type)
			{
				case 'Ban':
				case 'Unban':
					collector.on('collect', message =>
					{
						if (/Ban|Unban/.test(message.embeds[0].description.match(actionRegex)[1])) found = message;
						if (found) collector.stop('found');
					});
					break;

				case 'Softban':
					let softbanResult: boolean[] = [false, false];
					found = [null, null];
					collector.on('collect', message =>
					{
						const caseType: string = message.embeds[0].description.match(actionRegex)[1];
						const index: int = caseType === 'Ban' ? 0 : caseType === 'Unban' ? 1 : null;
						if (typeof index !== 'number') return;
						(<Message[]> found)[index] = message;
						softbanResult[index] = true;
						if (softbanResult.reduce((a, b) => a && b)) collector.stop('found');
					});
			}

			if (type === 'Ban') await this._client.mod.actions.ban(user, guild, reason);
			if (type === 'Unban') await this._client.mod.actions.unban(user.id, guild);
			if (type === 'Softban') await this._client.mod.actions.softban(user, guild, reason);
		});
	}

	/**
	 * Given a case message with a correct case number,
	 * find the cases after it and set their case numbers
	 * in order, setting guild cases to the final number
	 * when finished
	 */
	public async fixCases(start: Message): Promise<boolean>
	{
		const caseRegex: RegExp = /Case (\d+)/;
		if (start.channel.id !== await start.guild.storage.settings.get('modlogs')
			|| (start.embeds[0] && !caseRegex.test(start.embeds[0].footer.text))) return false;

		const logs: TextChannel = <TextChannel> start.channel;
		let currentCase: int = parseInt(start.embeds[0].footer.text.match(caseRegex)[1]);

		let cases: Message[] = [];
		while (true)
		{
			let fetched: Message[] = (await logs.fetchMessages({
				limit: 100,
				after: cases.length > 0 ? cases[cases.length - 1].id : start.id
			})).array().reverse();
			cases.push(...fetched);
			if (fetched.length < 100) break;
		}

		if (cases.find(c => c.author.id !== this._client.user.id))
			throw `Operation failed: Found at least one case that cannot be edited.`;

		for (const loggedCase of cases)
		{
			if (loggedCase.embeds.length === 0
				|| (loggedCase.embeds[0] && !caseRegex.test(loggedCase.embeds[0].footer.text))) continue;

			let messageEmbed: MessageEmbed = loggedCase.embeds[0];
			const embed: RichEmbed = new RichEmbed()
				.setColor(messageEmbed.color)
				.setAuthor(messageEmbed.author.name, messageEmbed.author.iconURL)
				.setDescription(messageEmbed.description)
				.setFooter(`Case ${++currentCase}`)
				.setTimestamp(new Date(messageEmbed.createdTimestamp));

			await loggedCase.edit('', { embed });
		}
		await start.guild.storage.settings.set('cases', currentCase);

		return true;
	}
}
