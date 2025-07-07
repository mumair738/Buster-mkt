# Handling Context URLs in Prediction Markets

## **Current Implementation ✅**

Your Buster Market platform now has comprehensive URL context handling:

### 1. **Automatic URL Detection**

- URLs in market questions are automatically detected
- Converted to clickable, styled links
- Display domain name for quick identification

### 2. **URL Preview System**

- Expandable preview cards for external links
- Fetch metadata (title, description, image) safely
- Whitelist of trusted domains for verification
- Security measures to prevent malicious content

### 3. **Market Context Component**

- Categorizes different types of context URLs:
  - **Polymarket References** - Links to related Polymarket predictions
  - **News Sources** - Reuters, Bloomberg, CNN, etc.
  - **Social Media** - Twitter/X posts for context
  - **Documentation** - GitHub, official docs
  - **Event Information** - Calendar events, official announcements
  - **Generic** - Other external references

## **Best Practices for Market Creators**

### 1. **Question Format with Context**

```
Will Bitcoin reach $100,000 by end of 2024?
Reference: https://www.coindesk.com/markets/2024/01/15/bitcoin-analysis
Related market: https://polymarket.com/market/bitcoin-100k-2024
```

### 2. **Context URL Types**

**📈 Market References**

- Link to related Polymarket predictions
- Reference similar markets for comparison
- Historical market outcomes

**📰 News Sources**

- Official announcements
- Expert analysis
- Breaking news that affects the outcome

**📅 Event Information**

- Official event pages
- Government announcements
- Company earnings calls

**📱 Social Context**

- Official statements from key figures
- Viral posts that drive market sentiment
- Community discussions

### 3. **URL Safety & Trust**

**Trusted Domains** (Verified ✅)

- polymarket.com
- bloomberg.com, reuters.com
- twitter.com, x.com
- github.com
- Major news outlets

**Display Features:**

- Green border = Verified trusted source
- Yellow border = Unverified but allowed
- Preview cards with metadata
- Clear domain identification

## **Example Market Questions**

### ✅ Good Examples:

**Election Markets:**

```
Will candidate X win the 2024 election in State Y?
Official results: https://elections.gov/state-y/results
Polling data: https://fivethirtyeight.com/polls/state-y
```

**Sports Betting:**

```
Will Team A beat Team B in the championship?
Match details: https://espn.com/team-a-vs-team-b
Injury report: https://nfl.com/injury-report-week-15
```

**Crypto Markets:**

```
Will Ethereum upgrade successfully deploy by Q2 2024?
Official roadmap: https://ethereum.org/roadmap
Developer updates: https://github.com/ethereum/execution-specs
```

**Tech/Business:**

```
Will Company X's stock price exceed $200 by year-end?
Earnings calendar: https://investor.company-x.com/events
Analyst reports: https://bloomberg.com/company-x-analysis
```

### ❌ Avoid:

- Unverified social media rumors
- Paywall-locked content
- Temporary links that expire
- Misleading or clickbait sources
- Personal blogs without credibility

## **Security Features**

1. **Domain Whitelisting** - Only trusted sources get verified status
2. **Timeout Protection** - 5-second limit on metadata fetching
3. **Content Sanitization** - Safe HTML extraction
4. **User Agent Identification** - Proper bot identification
5. **Error Handling** - Graceful fallbacks for failed requests

## **For Developers**

The system includes:

- `/api/url-metadata` endpoint for safe metadata fetching
- `UrlPreview` component for rich link previews
- `MarketContext` component for categorized context display
- `LinkifiedText` component for automatic URL detection

This creates a trustworthy, user-friendly way to provide context while maintaining security and preventing abuse.
