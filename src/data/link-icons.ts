/**
 * Maps a `links` label (from a meetup's YAML) to an icon in
 * `public/img/links/`. Case-insensitive so `LinkedIn`/`linkedin` both match.
 * An unrecognised label (a platform not listed here, or a typo) falls back
 * to a generic link icon rather than rendering nothing.
 */
const LINK_ICONS: Record<string, string> = {
	linkedin: '/img/links/linkedin.svg',
	discord: '/img/links/discord.svg',
	instagram: '/img/links/instagram.svg',
	tiktok: '/img/links/tiktok.svg',
	bluesky: '/img/links/bluesky.svg',
	facebook: '/img/links/facebook.svg',
	x: '/img/links/x.svg',
	website: '/img/links/website.svg',
};

const DEFAULT_LINK_ICON = '/img/links/website.svg';

export function linkIcon(label: string): string {
	return LINK_ICONS[label.trim().toLowerCase()] ?? DEFAULT_LINK_ICON;
}
