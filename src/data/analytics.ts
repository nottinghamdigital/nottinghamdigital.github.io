/**
 * Visitor analytics: GoatCounter (https://www.goatcounter.com).
 *
 * Cookieless and storing nothing on the device — the count is de-duplicated
 * server-side from a daily-rotated hash — so the site needs no consent banner
 * and the footer's privacy line stays true. Change the endpoint here and
 * nowhere else; `BaseLayout` renders the beacon only when it is non-empty, so
 * a fork can opt out by emptying this string.
 */
export const GOATCOUNTER_ENDPOINT =
	'https://nottinghamdigital.goatcounter.com/count';

/** The public dashboard for the endpoint above, linked from the footer. */
export const GOATCOUNTER_DASHBOARD = 'https://nottinghamdigital.goatcounter.com';
