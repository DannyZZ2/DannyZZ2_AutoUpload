import type { Platform, PlatformConfig } from "../shared/types";

export const platformConfigs: Record<Platform, PlatformConfig> = {
  douyin: {
    id: "douyin",
    name: "抖音",
    coverMode: "both",
    publisherUrl: "https://creator.douyin.com/creator-micro/content/upload"
  },
  bilibili: {
    id: "bilibili",
    name: "B站",
    coverMode: "4:3 + 16:9",
    publisherUrl: "https://member.bilibili.com/platform/upload/video/frame"
  },
  xiaohongshu: {
    id: "xiaohongshu",
    name: "小红书",
    coverMode: "3:4",
    publisherUrl: "https://creator.xiaohongshu.com/publish/publish"
  },
  wechat_channels: {
    id: "wechat_channels",
    name: "视频号",
    coverMode: "3:4",
    publisherUrl: "https://channels.weixin.qq.com/platform/post/create"
  },
  weibo: {
    id: "weibo",
    name: "微博",
    coverMode: "16:9",
    publisherUrl: "https://weibo.com/"
  }
};

export function getPlatformConfig(platform: Platform) {
  return platformConfigs[platform];
}
