import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Rising",
  version: packageJson.version,
  copyright: `© ${currentYear}, Rising.`,
  meta: {
    title: "Rising - Dynamic equity engine",
    description:
      "Rising turns real work signals into transparent, consensus-approved equity recommendations for startup teams.",
  },
};
