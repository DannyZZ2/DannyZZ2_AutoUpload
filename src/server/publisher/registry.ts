import type { Platform } from "../../shared/types";
import type { PlatformPublisherAdapter } from "./adapter";
import { BilibiliAdapter } from "./platforms/bilibili";
import { DouyinAdapter } from "./platforms/douyin";
import { WechatChannelsAdapter } from "./platforms/wechatChannels";
import { WeiboAdapter } from "./platforms/weibo";
import { XiaohongshuAdapter } from "./platforms/xiaohongshu";

const adapters: Record<Platform, PlatformPublisherAdapter> = {
  douyin: new DouyinAdapter(),
  bilibili: new BilibiliAdapter(),
  xiaohongshu: new XiaohongshuAdapter(),
  wechat_channels: new WechatChannelsAdapter(),
  weibo: new WeiboAdapter()
};

export function getAdapter(platform: Platform) {
  return adapters[platform];
}
