export class CreateServerDto {
  name!: string;
  icon?: string;
  creatorId?: string;
}

export class UpdateServerDto {
  name?: string;
  icon?: string;
}

export class CreateChannelDto {
  name!: string;
  type!: 'text' | 'voice';
}

export class Channel {
  id!: string;
  name!: string;
  type!: 'text' | 'voice';
  unreadCount?: number;
}

export class Server {
  id!: string;
  name!: string;
  icon!: string;
  channels!: Channel[];
  members?: string[];
}
