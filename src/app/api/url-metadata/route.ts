import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || !isValidUrl(url)) {
      return NextResponse.json(
        { error: "Invalid URL provided" },
        { status: 400 }
      );
    }

    // For security, only allow certain domains or use a whitelist
    const allowedDomains = [
      "polymarket.com",
      "manifold.markets",
      "twitter.com",
      "x.com",
      "github.com",
      "medium.com",
      "substack.com",
      "news.ycombinator.com",
      "reddit.com",
      "bloomberg.com",
      "reuters.com",
      "cnn.com",
      "bbc.com",
      "techcrunch.com",
      "coindesk.com",
      "cointelegraph.com",
    ];

    const domain = new URL(url).hostname.replace("www.", "");
    const isAllowed = allowedDomains.some(
      (allowedDomain) =>
        domain === allowedDomain || domain.endsWith("." + allowedDomain)
    );

    if (!isAllowed) {
      return NextResponse.json({
        domain,
        title: `Content from ${domain}`,
        description: "External reference - click to view",
        trusted: false,
      });
    }

    // Fetch the page with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Buster Market Bot/1.0 (+https://buster-mkt.vercel.app)",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const metadata = extractMetadata(html, domain);

      return NextResponse.json({
        ...metadata,
        domain,
        trusted: true,
      });
    } catch (fetchError) {
      clearTimeout(timeout);
      console.error("Error fetching URL:", fetchError);

      return NextResponse.json({
        domain,
        title: `Content from ${domain}`,
        description: "Unable to load preview - click to view",
        trusted: isAllowed,
      });
    }
  } catch (error) {
    console.error("URL metadata API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function isValidUrl(string: string): boolean {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractMetadata(html: string, domain: string) {
  // Simple regex-based extraction (in production, use a proper HTML parser)
  const titleMatch = html.match(/<title[^>]*>([^<]*)</i);
  const descriptionMatch =
    html.match(
      /<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"']*)["\'][^>]*>/i
    ) ||
    html.match(
      /<meta[^>]*content=["\']([^"']*)["\'][^>]*name=["\']description["\'][^>]*>/i
    );

  const ogTitleMatch =
    html.match(
      /<meta[^>]*property=["\']og:title["\'][^>]*content=["\']([^"']*)["\'][^>]*>/i
    ) ||
    html.match(
      /<meta[^>]*content=["\']([^"']*)["\'][^>]*property=["\']og:title["\'][^>]*>/i
    );

  const ogDescriptionMatch =
    html.match(
      /<meta[^>]*property=["\']og:description["\'][^>]*content=["\']([^"']*)["\'][^>]*>/i
    ) ||
    html.match(
      /<meta[^>]*content=["\']([^"']*)["\'][^>]*property=["\']og:description["\'][^>]*>/i
    );

  const ogImageMatch =
    html.match(
      /<meta[^>]*property=["\']og:image["\'][^>]*content=["\']([^"']*)["\'][^>]*>/i
    ) ||
    html.match(
      /<meta[^>]*content=["\']([^"']*)["\'][^>]*property=["\']og:image["\'][^>]*>/i
    );

  const title =
    ogTitleMatch?.[1] || titleMatch?.[1] || `Content from ${domain}`;
  const description =
    ogDescriptionMatch?.[1] ||
    descriptionMatch?.[1] ||
    "Click to view external content";
  const image = ogImageMatch?.[1];

  return {
    title: title.trim(),
    description: description.trim(),
    image: image?.trim(),
  };
}
