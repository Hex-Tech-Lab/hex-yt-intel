export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white py-4 text-center">
      <p className="text-sm text-gray-600">
        AI Clarity Signage: Powered by{' '}
        <a
          href="https://anthropic.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Anthropic Claude
        </a>
      </p>
    </footer>
  );
}
