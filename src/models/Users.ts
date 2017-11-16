"use strict"

import * as _ from 'lodash';

import { Db, Collection } from 'mongodb';
import { Cache } from '../libs/data/Cache';
import { BotConfig, Playlist, GuildUser, Track } from '../typings';

export class Users {

  private playlistIdCacheId = `PlaylistIds`;
  private collectionName = 'Users';
  private collection: Collection;

  constructor(db: Db, private cache: Cache, config: BotConfig) {
    this.collection = db.collection(this.collectionName);
  }

  public getList(members: string[]): Promise<GuildUser[]> {
    return this.collection.find({ userId: { $in: members } }).toArray();
  }

  public async getUser(userId: string) {
    const cacheId = `User:${userId}`;
    let user: GuildUser;
    if (!this.cache.has(cacheId)) {
      const doc = await this.collection.findOneAndUpdate({ userId: userId }, { $setOnInsert: this.newUser(userId) }, { upsert: true, returnOriginal: false });
      user = doc.value;
      this.cache.update(cacheId, user);
    } else user = this.cache.get(cacheId);
    return user;
  }

  public async getUsedPlaylistId() {
    if (!this.cache.has(this.playlistIdCacheId)) {
      const doc = await this.collection.findOneAndUpdate({ type: this.playlistIdCacheId }, { $setOnInsert: { ids: [] } }, { upsert: true, returnOriginal: false });
      this.cache.update(this.playlistIdCacheId, doc.value);
    }
    return this.cache.get(this.playlistIdCacheId);
  }

  public async getUserFromPlaylistId(plId: string) {
    const playlistId = await this.getUsedPlaylistId();
    const playlistIdList: { plId: string, user: string }[] = playlistId.ids;
    const item = playlistIdList.find(x => x.plId === plId);
    if (_.isNil(item)) return null;
    return await this.getUser(item.user);
  } 

  public async newPlaylist(userId: string, plId: string, name: string) {
    let usedIds = await this.getUsedPlaylistId();
    if (usedIds.ids.some(elem => elem.plId === plId))
      return `The ID \`${plId}\` is already in use! Try a different one!`;

    const set: { [x: string]: Playlist } = {};
    set[`playlists.list.${plId}`] = { name: name, size: 0, list: [] };
    await this.addPlaylistId(plId, userId);
    const doc = await this.collection.findOneAndUpdate({ userId: userId }, { $inc: { "playlists.num": 1 }, $set: set }, { returnOriginal: false });
    this.updateUserCache(userId, doc.value);
  }

  public async deletePlaylist(userId: string, plId: string) {
    let user = await this.getUser(userId);
    if (_.isNil(user.playlists.list[plId]))
      return `You have no playlist identified by \`${plId}\``;

    const unset = {};
    unset[`playlists.list.${plId}`] = "";
    await this.removePlaylistId(plId);
    const doc = await this.collection.findOneAndUpdate({ userId: userId }, { $inc: { "playlists.num": -1 }, $unset: unset }, { returnOriginal: false });
    this.updateUserCache(userId, doc.value);
  }

  public async addToPlaylist(userId: string, plId: string, tracks: Track[]) {
    let user = await this.getUser(userId);
    if (_.isNil(user.playlists.list[plId]))
      return `You have no playlist identified by \`${plId}\``;

    const playlist = user.playlists.list[plId];
    playlist.list = playlist.list.concat(tracks);
    playlist.size = playlist.list.length;
    const set = {};
    set[`playlists.list.${plId}`] = playlist;
    const doc = await this.collection.findOneAndUpdate({ userId: userId }, { $set: set }, { returnOriginal: false });
    this.updateUserCache(userId, doc.value);
  }

  public async removeFromPlaylist(userId: string, plId: string, idx1: number, idx2?: number) {
    let user = await this.getUser(userId);
    if (_.isNil(user.playlists.list[plId]))
      return `You have no playlist identified by \`${plId}\``;
    
    const playlist = user.playlists.list[plId];
    const lengthPrior = playlist.list.length;
    if (_.isNil(idx2)) playlist.list.splice(idx1, 1);
    else if (idx2 === 0) playlist.list.splice(idx1, playlist.list.length - idx1);
    else playlist.list.splice(idx1, (idx2 < 0 ? playlist.list.length + idx2 : idx2) - idx1);
    playlist.size = playlist.list.length;
    if (playlist.size === lengthPrior)
      return `Query resulted in no tracks being removed!`;

    const set = {};
    set[`playlists.list.${plId}`] = playlist;
    const doc = await this.collection.findOneAndUpdate({ userId: userId }, { $set: set }, { returnOriginal: false });
    this.updateUserCache(userId, doc.value);
  }

  private newUser(userId: string): GuildUser {
    return { userId: userId, playlists: { num: 0, list: {}}};
  }

  private updateUserCache(userId: string, user: GuildUser) {
    this.cache.update(`User:${userId}`, user);
  }

  private async removePlaylistId(plId: string) {
    const doc = await this.collection.findOneAndUpdate({ type: this.playlistIdCacheId }, { $pull: { ids: { plId: plId } } }, { upsert: true, returnOriginal: false });
    this.cache.update(this.playlistIdCacheId, doc.value);
  }

  private async addPlaylistId(plId: string, userId: string) {
    const doc = await this.collection.findOneAndUpdate({ type: this.playlistIdCacheId }, { $push: { ids: { plId: plId, user: userId } } }, { upsert: true, returnOriginal: false });
    this.cache.update(this.playlistIdCacheId, doc.value);
  }
}