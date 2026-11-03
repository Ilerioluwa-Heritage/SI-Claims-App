// Cloudflare Pages runs this before sending any page or file of the website:
// only visitors that Cloudflare Access signed in get through. See src/gate/access.ts.
export { onRequest } from '../src/gate/access.ts';
