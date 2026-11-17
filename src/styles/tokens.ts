// Generated from design/tokens.json by `pnpm tokens`. Do not edit.
export const TYPE_STYLES = ["headline-xl","headline-l","headline-m","question-xl","figure","title-l","transcript","title","subtitle","button","button-l","body-l","body-l-strong","body","body-strong","label","caption","caption-strong","code"] as const
export type TypeStyle = (typeof TYPE_STYLES)[number]
export const COLOR_TOKENS = ["bg","surface","surface-2","divider","border","border-control","text","text-2","text-muted","text-subtle","on-accent","accent","accent-text","accent-text-strong","accent-soft","accent-panel","accent-panel-border","warn","warn-text","warn-text-muted","warn-panel","warn-panel-border"] as const
export type ColorToken = (typeof COLOR_TOKENS)[number]
// Values for the few places a CSS variable cannot reach (the web app manifest, theme-color).
export const COLOR_VALUES = {"bg":"#000000","surface":"#141414","surface-2":"#1F1F1F","divider":"#262626","border":"#2E2E2E","border-control":"#737373","text":"#FFFFFF","text-2":"#D9D9D9","text-muted":"#A6A6A6","text-subtle":"#8C8C8C","on-accent":"#FFFFFF","accent":"#036CFF","accent-text":"#3D8BFF","accent-text-strong":"#CCE1FF","accent-soft":"#0A2A5E","accent-panel":"#04224F","accent-panel-border":"#0A4AAE","warn":"#FF9F43","warn-text":"#FFC58F","warn-text-muted":"#C8B29C","warn-panel":"#23190F","warn-panel-border":"#6B4520"} as const satisfies Record<ColorToken, string>
// Size tokens in px, for the few places CSS cannot size (the intrinsic width and height of an image).
export const SIZE_PX = {"size-icon-s":20,"size-icon":24,"size-icon-l":32,"size-icon-xl":56,"size-bar":8,"size-dot":12,"size-control-s":44,"size-control":48,"size-control-l":56,"size-tile":72,"size-hero":96,"size-orb":144,"size-column-three":1016} as const
