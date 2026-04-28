export type RssFeedCatalogEntry = {
  readonly title: string;
  readonly feedUrl: string;
};

export type RssFeedCatalogPack = {
  readonly id: string;
  /** UI group: dev, blogs, news, science, etc. */
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly feeds: readonly RssFeedCatalogEntry[];
};

/**
 * Curated RSS packs users can add in one action (live folders, one per feed).
 * URLs are stable https sources; duplicates are skipped server-side.
 */
export const RSS_FEED_CATALOG_PACKS = [
  {
    id: "tech-news",
    category: "News",
    title: "Tech & dev news",
    description: "Aggregators and weekly digests — front-page signal without social noise.",
    feeds: [
      { title: "Hacker News — front page", feedUrl: "https://hnrss.org/frontpage" },
      { title: "Hacker News — best comments", feedUrl: "https://hnrss.org/bestcomments" },
      { title: "Lobsters", feedUrl: "https://lobste.rs/rss" },
      { title: "This Week in Rust", feedUrl: "https://this-week-in-rust.org/rss.xml" },
      { title: "Simon Willison", feedUrl: "https://simonwillison.net/atom/everything/" },
      { title: "Latent Space", feedUrl: "https://www.latent.space/feed" },
      { title: "Zig NEWS", feedUrl: "https://zig.news/feed" },
      {
        title: "Graphics Programming weekly",
        feedUrl: "https://www.jendrikillner.com/post/index.xml",
      },
      { title: "Terminal Trove — new tools", feedUrl: "https://terminaltrove.com/new.xml" },
      { title: "AI News", feedUrl: "https://news.smol.ai/rss.xml" },
      { title: "ElixirStatus", feedUrl: "https://elixirstatus.com/rss" },
      { title: "Servo Blog", feedUrl: "https://servo.org/blog/feed.xml" },
      { title: "Zig Weekly", feedUrl: "https://mastodon.social/@zig_discussions.rss" },
    ],
  },
  {
    id: "tech-blogs",
    category: "Blogs",
    title: "Indie & systems blogs",
    description: "Long-form engineering writing — compilers, browsers, and craft.",
    feeds: [
      { title: "Julia Evans", feedUrl: "https://jvns.ca/atom.xml" },
      { title: "fasterthanli.me", feedUrl: "https://fasterthanli.me/index.xml" },
      { title: "matklad", feedUrl: "https://matklad.github.io/feed.xml" },
      { title: "Rust Blog", feedUrl: "https://blog.rust-lang.org/feed.xml" },
      { title: "surma.dev", feedUrl: "https://surma.dev/index.xml" },
      { title: "Zed Blog", feedUrl: "https://zed.dev/blog.rss" },
      { title: "Trail of Bits", feedUrl: "https://blog.trailofbits.com/index.xml" },
      { title: "Xe Iaso", feedUrl: "https://xeiaso.net/blog.rss" },
      { title: "Daring Fireball", feedUrl: "https://daringfireball.net/feeds/json" },
      { title: "Armin Ronacher", feedUrl: "https://lucumr.pocoo.org/feed.atom" },
      { title: "Daniel Lemire", feedUrl: "https://lemire.me/blog/feed/" },
      { title: "Entropic Thoughts", feedUrl: "https://entropicthoughts.com/feed" },
      { title: "mtlynch", feedUrl: "https://mtlynch.io/posts/index.xml" },
      { title: "Scott Redig", feedUrl: "https://www.scottredig.com/rss.xml" },
      { title: "Sebastiano Tronto", feedUrl: "https://sebastiano.tronto.net/blog/feed.xml" },
      { title: "Xuanwo", feedUrl: "https://xuanwo.io/index.xml" },
    ],
  },
  {
    id: "programming-language",
    category: "Engineering",
    title: "Languages & tooling",
    description: "Compiler, runtime, and language ecosystem updates.",
    feeds: [
      { title: "Rust GPU Blog", feedUrl: "https://rust-gpu.github.io/blog/rss.xml" },
      { title: "Futhark Developer Blog", feedUrl: "https://futhark-lang.org/atom.xml" },
      { title: "Reasonably Polymorphic", feedUrl: "https://reasonablypolymorphic.com/atom.xml" },
      { title: "Barry's C++ Blog", feedUrl: "https://brevzin.github.io/feed.xml" },
      { title: "journal.stuffwithstuff", feedUrl: "https://journal.stuffwithstuff.com/rss.xml" },
      { title: "Kobzol", feedUrl: "https://kobzol.github.io/feed.xml" },
      { title: "Corrode", feedUrl: "https://corrode.dev/rss.xml" },
      { title: "OpenMyMind", feedUrl: "https://www.openmymind.net/atom.xml" },
      { title: "Siboehm", feedUrl: "https://siboehm.com/feed.xml" },
      { title: "Ziglang subreddit", feedUrl: "https://www.reddit.com/r/zig.rss" },
    ],
  },
  {
    id: "security-infra",
    category: "Security",
    title: "Security & infra",
    description: "Security research, reliability, and production engineering.",
    feeds: [
      { title: "Trail of Bits", feedUrl: "https://blog.trailofbits.com/index.xml" },
      { title: "Octet Stream", feedUrl: "https://octet-stream.net/b/scb/rss.xml" },
      {
        title: "Hogg's Research",
        feedUrl: "https://hoggresearch.blogspot.com/feeds/posts/default",
      },
      { title: "Silvia Canelon", feedUrl: "https://silviacanelon.com/blog/index.xml" },
      { title: "pwy.io", feedUrl: "https://pwy.io/feed.xml" },
      { title: "Secret Weblog", feedUrl: "https://blog.startifact.com/atom.xml" },
      { title: "Seph", feedUrl: "https://josephg.com/blog/rss/" },
      { title: "Pierre Zemb", feedUrl: "https://pierrezemb.fr/rss.xml" },
      { title: "Thoughts from Eric", feedUrl: "https://meyerweb.com/eric/thoughts/rss2/full" },
    ],
  },
  {
    id: "product-design",
    category: "Product",
    title: "Design & product thinking",
    description: "Product strategy, interaction design, and calm workflow writing.",
    feeds: [
      { title: "Principles", feedUrl: "https://principles.page/feed/" },
      { title: "Bartosz Ciechanowski", feedUrl: "https://ciechanow.ski/atom.xml" },
      { title: "Noel Berry", feedUrl: "https://noelberry.ca/rss.xml" },
      { title: "near.blog", feedUrl: "https://near.blog/feed/" },
      { title: "brainbaking", feedUrl: "https://brainbaking.com/post/index.xml" },
      { title: "Loren Stewart", feedUrl: "https://www.lorenstew.art/rss.xml" },
      { title: "Choly", feedUrl: "https://choly.ca/index.xml" },
      { title: "kristoff.it", feedUrl: "https://kristoff.it/index.xml" },
    ],
  },
  {
    id: "science-math",
    category: "Science",
    title: "Math & papers",
    description: "Research blogs and arXiv watchlists — good with a slower sync interval.",
    feeds: [
      { title: "Terence Tao (Mathstodon)", feedUrl: "https://mathstodon.xyz/@tao.rss" },
      { title: "Lil'Log", feedUrl: "https://lilianweng.github.io/index.xml" },
      {
        title: 'ArXiv — "agent"',
        feedUrl:
          "https://export.arxiv.org/api/query?search_query=all:%22agent%22&sortBy=lastUpdatedDate&sortOrder=descending",
      },
      {
        title: 'ArXiv — "lean 4"',
        feedUrl:
          "https://export.arxiv.org/api/query?search_query=all:%22lean+4%22&sortBy=lastUpdatedDate&sortOrder=descending",
      },
      { title: "Thesis Whisperer", feedUrl: "https://thesiswhisperer.com/feed/" },
      { title: "MIT Physics", feedUrl: "https://physics.mit.edu/feed/" },
      {
        title: "Not Even Wrong",
        feedUrl: "https://www.math.columbia.edu/~woit/wordpress/?feed=rss2",
      },
      {
        title: "Recent Articles in Physics",
        feedUrl: "http://feeds.aps.org/rss/recent/physics.xml",
      },
      { title: "3blue1brown", feedUrl: "https://openrss.org/bsky.app/profile/3blue1brown.com" },
      { title: "John Carlos Baez", feedUrl: "https://mathstodon.xyz/@johncarlosbaez.rss" },
      { title: "Xena Project", feedUrl: "https://xenaproject.wordpress.com/feed/" },
    ],
  },
  {
    id: "web-dev-front-end",
    category: "Web",
    title: "Web & frontend",
    description: "Browser platform, frontend engineering, and web performance.",
    feeds: [
      { title: "surma.dev", feedUrl: "https://surma.dev/index.xml" },
      { title: "Eric Meyer", feedUrl: "https://meyerweb.com/eric/thoughts/rss2/full" },
      { title: "dbushell", feedUrl: "https://dbushell.com/rss.xml" },
      { title: "Glyph", feedUrl: "https://blog.glyph.im/feeds/all.atom.xml" },
      { title: "DYNOMIGHT", feedUrl: "https://dynomight.net/feed.xml" },
      { title: "Silvia Canelon", feedUrl: "https://silviacanelon.com/blog/index.xml" },
      { title: "journal.stuffwithstuff", feedUrl: "https://journal.stuffwithstuff.com/rss.xml" },
      { title: "Rust Blog", feedUrl: "https://blog.rust-lang.org/feed.xml" },
    ],
  },
] as const satisfies readonly RssFeedCatalogPack[];
