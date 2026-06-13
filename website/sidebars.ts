import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  main: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "getting-started/prerequisites",
        "getting-started/quick-start-docker",
        "getting-started/local-development",
      ],
    },
    {
      type: "category",
      label: "Usage",
      items: ["usage/app-walkthrough", "usage/pwa-installation"],
    },
    {
      type: "category",
      label: "Architecture",
      items: [
        "architecture/overview",
        "architecture/backend",
        "architecture/frontend",
        "architecture/data-flow",
        "architecture/caching",
      ],
    },
    {
      type: "category",
      label: "Configuration",
      items: [
        "configuration/environment-variables",
        "configuration/docker-compose",
      ],
    },
    {
      type: "category",
      label: "API",
      items: ["api/reference", "api/conventions"],
    },
    "database",
    {
      type: "category",
      label: "Development",
      items: [
        "development/workflow",
        "development/scripts",
        "development/codegen",
      ],
    },
    {
      type: "category",
      label: "Testing",
      items: [
        "testing/concept",
        "testing/backend-unit",
        "testing/frontend-unit",
        "testing/end-to-end",
      ],
    },
    {
      type: "category",
      label: "Operations",
      items: [
        "operations/deployment",
        "operations/monitoring",
        "operations/health-checks",
        "operations/ci-cd",
      ],
    },
    "security",
    "troubleshooting",
    "contributing",
  ],
};

export default sidebars;
