import { BaseWebAdapter } from "../baseWebAdapter";

export class BilibiliAdapter extends BaseWebAdapter {
  platform = "bilibili" as const;

  protected profile = {
    videoInputs: [
      'input[type="file"][accept*="video"]',
      'input[type="file"]'
    ],
    cover43Inputs: [
      'input[type="file"][accept*="image"]',
      'input[type="file"] >> nth=1'
    ],
    titleInputs: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]'
    ],
    descriptionInputs: [
      'textarea[placeholder*="简介"]',
      'textarea[placeholder*="描述"]',
      '[contenteditable="true"]'
    ],
    tagInputs: [
      'input[placeholder*="标签"]',
      'input[placeholder*="按回车键添加标签"]'
    ],
    submitImmediateTexts: ["立即投稿", "投稿", "发布"]
  };
}
