const proxyUrl = "brd-customer-hl_da92bd7c-zone-yt_intel_prx1:qa0ffc1kewsa@brd.superproxy.io:33335";
const atIndex = proxyUrl.lastIndexOf('@');
const credentials = proxyUrl.slice(0, atIndex);
const hostPort = proxyUrl.slice(atIndex + 1);
console.log({ credentials, hostPort });
