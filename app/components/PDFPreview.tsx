import { FileDown } from 'lucide-react';

interface PDFPreviewProps {
  name: string;
  url: string;
}

export default function PDFPreview({ name, url }: PDFPreviewProps) {
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
      <div className="flex-shrink-0">
        <svg
          className="w-8 h-8 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      </div>
      <div className="flex-grow min-w-0">
        <p className="text-sm font-medium text-white truncate">{name}</p>
        <p className="text-xs text-zinc-400">PDF Document</p>
      </div>
      <button
        onClick={handleDownload}
        className="flex-shrink-0 p-2 text-zinc-400 hover:text-white transition-colors"
        title="Download PDF"
      >
        <FileDown className="w-5 h-5" />
      </button>
    </div>
  );
} 