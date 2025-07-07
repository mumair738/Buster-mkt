"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ExternalLink,
  TrendingUp,
  FileText,
  Globe,
  Calendar,
} from "lucide-react";

interface MarketContextProps {
  question: string;
  className?: string;
}

interface ContextItem {
  type:
    | "polymarket"
    | "news"
    | "social"
    | "documentation"
    | "event"
    | "generic";
  url: string;
  text: string;
}

export function MarketContext({ question, className }: MarketContextProps) {
  // Extract context items from the question
  const extractContextItems = (text: string): ContextItem[] => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex) || [];

    return urls.map((url) => {
      const domain = getDomain(url);
      let type: ContextItem["type"] = "generic";

      if (domain.includes("polymarket")) type = "polymarket";
      else if (domain.includes("twitter") || domain.includes("x.com"))
        type = "social";
      else if (isNewsSource(domain)) type = "news";
      else if (domain.includes("github") || domain.includes("docs."))
        type = "documentation";
      else if (url.includes("event") || url.includes("calendar"))
        type = "event";

      return {
        type,
        url,
        text: getDisplayText(url, type),
      };
    });
  };

  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return url;
    }
  };

  const isNewsSource = (domain: string) => {
    const newsSources = [
      "reuters.com",
      "bloomberg.com",
      "cnn.com",
      "bbc.com",
      "techcrunch.com",
      "coindesk.com",
      "cointelegraph.com",
      "news.ycombinator.com",
      "reddit.com",
    ];
    return newsSources.some((source) => domain.includes(source));
  };

  const getDisplayText = (url: string, type: ContextItem["type"]) => {
    const domain = getDomain(url);
    switch (type) {
      case "polymarket":
        return `Polymarket Reference (${domain})`;
      case "news":
        return `News Source (${domain})`;
      case "social":
        return `Social Reference (${domain})`;
      case "documentation":
        return `Documentation (${domain})`;
      case "event":
        return `Event Information (${domain})`;
      default:
        return `External Reference (${domain})`;
    }
  };

  const getIcon = (type: ContextItem["type"]) => {
    switch (type) {
      case "polymarket":
        return <TrendingUp className="w-4 h-4" />;
      case "news":
        return <FileText className="w-4 h-4" />;
      case "social":
        return <Globe className="w-4 h-4" />;
      case "documentation":
        return <FileText className="w-4 h-4" />;
      case "event":
        return <Calendar className="w-4 h-4" />;
      default:
        return <ExternalLink className="w-4 h-4" />;
    }
  };

  const getBadgeVariant = (type: ContextItem["type"]) => {
    switch (type) {
      case "polymarket":
        return "default";
      case "news":
        return "secondary";
      case "social":
        return "outline";
      case "documentation":
        return "secondary";
      case "event":
        return "default";
      default:
        return "outline";
    }
  };

  const contextItems = extractContextItems(question);

  if (contextItems.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Market Context</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {contextItems.map((item, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-2 border rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {getIcon(item.type)}
              <span className="text-sm text-gray-700 truncate">
                {item.text}
              </span>
              <Badge variant={getBadgeVariant(item.type)} className="text-xs">
                {item.type}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              asChild
              className="ml-2 flex-shrink-0"
            >
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
