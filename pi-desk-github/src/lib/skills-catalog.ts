// 推荐技能目录（来自官方 Pi Skills 仓库 badlogic/pi-skills）
export interface CatalogSkill {
  name: string;
  desc: string;
  repo: string;
  prefix: string;
  badge?: string;
}

export const SKILLS_CATALOG: CatalogSkill[] = [
  { name: "brave-search", desc: "网页搜索与内容提取（Brave Search API），无需浏览器", repo: "badlogic/pi-skills", prefix: "" },
  { name: "browser-tools", desc: "浏览器自动化，操控 Chrome 测试网页、抓取动态内容", repo: "badlogic/pi-skills", prefix: "" },
  { name: "youtube-transcript", desc: "提取 YouTube 视频字幕，用于总结与分析", repo: "badlogic/pi-skills", prefix: "" },
  { name: "vscode", desc: "VS Code 集成：查看 diff、对比文件", repo: "badlogic/pi-skills", prefix: "" },
  { name: "gccli", desc: "Google 日历：查看/创建日程、查空闲时间", repo: "badlogic/pi-skills", prefix: "" },
  { name: "gdcli", desc: "Google Drive：搜索、上传、下载、分享文件", repo: "badlogic/pi-skills", prefix: "" },
  { name: "gmcli", desc: "Gmail：搜索邮件、读写邮件、管理标签", repo: "badlogic/pi-skills", prefix: "" },
  { name: "transcribe", desc: "本地语音转文字（仅 Apple Silicon macOS）", repo: "badlogic/pi-skills", prefix: "", badge: "macOS" },
];
