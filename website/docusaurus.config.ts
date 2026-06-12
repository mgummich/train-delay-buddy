import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { themes as prismThemes } from "prism-react-renderer";

const ORG = "mgummich";
const PROJECT = "train-delay-buddy";

const config: Config = {
  title: "Verspätungs-Begleiter",
  tagline: "Real-time alternative routing for Deutsche Bahn journeys",
  favicon: "img/logo.svg",

  url: `https://${ORG}.github.io`,
  baseUrl: `/${PROJECT}/`,

  organizationName: ORG,
  projectName: PROJECT,
  deploymentBranch: "gh-pages",
  trailingSlash: false,

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: `https://github.com/${ORG}/${PROJECT}/edit/master/website/`,
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Verspätungs-Begleiter",
      logo: {
        alt: "Verspätungs-Begleiter logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "main",
          position: "left",
          label: "Documentation",
        },
        {
          href: `https://github.com/${ORG}/${PROJECT}`,
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Introduction", to: "/" },
            { label: "Quick start", to: "/getting-started/quick-start-docker" },
            { label: "Architecture", to: "/architecture/overview" },
            { label: "API reference", to: "/api/reference" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "GitHub", href: `https://github.com/${ORG}/${PROJECT}` },
            { label: "Issues", href: `https://github.com/${ORG}/${PROJECT}/issues` },
            {
              label: "HAFAS data source",
              href: "https://v6.db.transport.rest",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Verspätungs-Begleiter. Built with Docusaurus. Not affiliated with Deutsche Bahn.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "go", "yaml", "toml", "json", "sql", "nginx", "docker"],
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 4,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
