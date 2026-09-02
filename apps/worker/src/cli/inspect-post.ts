import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createDb, sites } from '@content-pilot/db';
import { resolveWordPressAdapter } from '../lib/resolve';

config({ path: resolve(process.cwd(), '../../.env') });

async function main() {
  const db = createDb();
  const [site] = await db.select().from(sites).limit(1);
  if (!site) throw new Error('sem site');
  const wp = await resolveWordPressAdapter(db, site);
  const id = Number(process.argv[2] ?? process.env.POST_ID ?? 11781);
  const post = await wp.getPost(id);
  const html = post.contentRaw;
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
  const blocks = (html.match(/<!-- wp:/g) ?? []).length;
  console.log('post:', post.title, '| status:', post.status);
  console.log('chars:', html.length, '| blocos Gutenberg:', blocks);
  console.log('links externos:', links.length);
  for (const l of links) console.log('  →', l);
  console.log('\ntrecho:', html.slice(0, 400).replace(/\s+/g, ' '));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
