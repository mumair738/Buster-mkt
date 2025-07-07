"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, Globe } from "lucide-react";

interface UrlPreviewProps {
  url: string;
  className?: string;
}

interface UrlMetadata {
  title?: string;
  description?: string;
  image?: string;
  domain: string;
  trusted?: boolean;
}

export function UrlPreview({ url, className }: UrlPreviewProps) {
  const [metadata, setMetadata] = useState<UrlMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const getDomain = (urlString: string) => {
    try {
      return new URL(urlString).hostname.replace("www.", "");
    } catch {
      return urlString;
    }
  };

  useEffect(() => {
    const fetchMetadata = async () => {
      if (!expanded) return;

      setLoading(true);
      try {
        const response = await fetch("/api/url-metadata", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url }),
        });

        if (response.ok) {
          const data = await response.json();
          setMetadata(data);
        } else {
          // Fallback to basic domain info
          const domain = getDomain(url);
          setMetadata({
            domain,
            title: `Content from ${domain}`,
            description: "Click to view external content",
            trusted: false,
          });
        }
      } catch (error) {
        console.error("Failed to fetch URL metadata:", error);
        const domain = getDomain(url);
        setMetadata({
          domain,
          title: `Content from ${domain}`,
          description: "Click to view external content",
          trusted: false,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchMetadata();
  }, [url, expanded]);

  return (
    <div className={className}>
      {/* Compact link display */}
      <div className="inline-flex items-center gap-2 my-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded-md text-blue-700 hover:bg-blue-100 transition-colors text-sm"
        >
          <Globe className="w-3 h-3" />
          {getDomain(url)}
          <ExternalLink className="w-3 h-3" />
        </a>

        {/* Toggle preview button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-gray-700 px-1"
        >
          {expanded ? "Hide" : "Preview"}
        </button>
      </div>

      {/* Expanded preview card */}
      {expanded && (
        <Card
          className={`mt-2 border-l-4 ${
            metadata?.trusted ? "border-l-green-500" : "border-l-yellow-500"
          }`}
        >
          <CardContent className="p-3">
            {loading ? (
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            ) : metadata ? (
              <div>
                {metadata.image && (
                  <img
                    src={metadata.image}
                    alt="Preview"
                    className="w-full h-32 object-cover rounded mb-2"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <h4 className="font-medium text-sm text-gray-900 mb-1">
                  {metadata.title || getDomain(url)}
                </h4>
                <p className="text-xs text-gray-600 mb-2">
                  {metadata.description || "External reference for this market"}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {metadata.domain}
                    </span>
                    {metadata.trusted && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-green-100 text-green-800">
                        Verified
                      </span>
                    )}
                  </div>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-500">
                Unable to load preview
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
