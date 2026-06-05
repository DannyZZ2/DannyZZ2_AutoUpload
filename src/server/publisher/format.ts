export function formatTags(tags: string[]) {
  return tags.map((tag) => `#${tag.replace(/^#/, "").trim()}`).filter(Boolean).join(" ");
}
