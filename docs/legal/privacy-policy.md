# Privacy Policy

**Last Updated:** June 9, 2026

Hex-YT Intel values your privacy and is committed to protecting your personal data in compliance with global standards, including the General Data Protection Regulation (GDPR) and the California Privacy Rights Act (CPRA). This policy explains our data processing practices, specifically regarding artificial intelligence.

## 1. Information We Collect
- **Account Data:** Name, email address, and authentication credentials (securely managed via Supabase).
- **Processing Data:** YouTube URLs, text prompts, and metadata submitted for summarization.
- **Output Data:** The AI-generated transcripts and summaries.
- **Technical Data:** IP address, browser type, device information, and essential cookies.

## 2. Purpose of Processing
We process your data to:
- Provide, maintain, and optimize the Hex-YT Intel service.
- Generate AI summaries via secure third-party Large Language Model (LLM) APIs.
- Detect fraud, abuse, and security vulnerabilities.

## 3. Data Custodian Defense: Automated Data Expiry
Hex-YT Intel operates as a real-time processing engine, not a permanent archive for third-party intellectual property. **We do not permanently store YouTube video data or full transcripts.**
- When you request a summary, we process the transcript in real-time.
- The source text and intermediate processing data are subjected to **Automated Data Expiry** and are permanently deleted from our temporary processing caches within 24 to 72 hours.
- Only the final, mathematically distinct, AI-generated summary is retained in your account dashboard.

## 4. AI Model Training & Data Usage
**We do not use your personal data or submitted video URLs to train our foundational AI models.** 
When your data is passed to our third-party LLM partners (such as via OpenRouter), it is strictly for the purpose of generating the requested summary. We specifically select and configure API partners whose standard enterprise terms dictate that API inputs and outputs are explicitly excluded from being used to train their models. *(Note for Future Reference: As the company scales, formal Enterprise Data Processing Agreements (DPAs) will be executed to guarantee this compliance).*

## 5. Third-Party Sharing & International Transfers
We do not sell your personal data. We share data only with essential service providers:
- **Infrastructure:** Vercel (Hosting), Cloudflare (Edge routing), Supabase (Database).
- **AI Processing:** OpenRouter (LLM routing).
For EU users, any data transferred outside the European Economic Area (EEA) is protected by Standard Contractual Clauses (SCCs) and appropriate technical safeguards.

## 6. Automated Decision-Making
Hex-YT Intel utilizes AI to generate summaries, but we do not engage in automated decision-making or profiling that produces legal or similarly significant effects concerning you.

## 7. Your Privacy Rights
### California Residents (CCPA/CPRA)
You have the right to request access to your data, request deletion, and opt-out of the "sharing" of personal data. Hex-YT Intel does not "sell" your data.

### European Economic Area (GDPR)
Under the GDPR, you have the following rights:
- **Access & Portability:** Request a copy of your personal data.
- **Right to be Forgotten:** Request deletion of your account and associated data.
To exercise any of these rights, please contact our Data Protection Officer at privacy@hex-yt-intel.com.

## 8. Security
We implement robust security measures, including HMAC validation for internal edge communication, encrypted database columns, and secure OAuth flows, to protect your data. However, no method of transmission over the internet is 100% secure.
