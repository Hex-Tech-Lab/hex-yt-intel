# Stream Token

The signed streaming token handed to the client for direct browser→worker flow.

## Description
This token is used to authenticate and authorize streaming requests from the client directly to the Cloudflare Worker, bypassing the main Next.js server for performance while maintaining security via HMAC signatures.
