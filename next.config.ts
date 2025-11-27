import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "imagedelivery.net",
      },
      // Cloudflare Images (alternative pattern)
      {
        protocol: "https",
        hostname: "*.imagedelivery.net",
      },
      // Farcaster profile picture domains
      {
        protocol: "https",
        hostname: "i.imgur.com",
      },
      {
        protocol: "https",
        hostname: "images.farcaster.xyz",
      },
      {
        protocol: "https",
        hostname: "farcaster.xyz",
      },
      {
        protocol: "https",
        hostname: "farcaster.com",
      },
      {
        protocol: "https",
        hostname: "imgur.com",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "pbs.twimg.com",
      },
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
      {
        protocol: "https",
        hostname: "i.seadn.io",
      },
      {
        protocol: "https",
        hostname: "openseauserdata.com",
      },
      {
        protocol: "https",
        hostname: "gateway.pinata.cloud",
      },
      // Catch-all for IPFS gateways and other common image hosts
      {
        protocol: "https",
        hostname: "*.ipfs.nftstorage.link",
      },
    ],
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config: any) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // Ignore React Native dependencies that aren't needed in web
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };

    // Suppress the warning for optional dependencies
    config.ignoreWarnings = [{ module: /node_modules\/@metamask\/sdk/ }];

    return config;
  },
};

export default nextConfig;
