import React, { useRef, useState } from 'react';

interface Props {
  onFile: (content: string) => void;
}

export default function FileUpload({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function read(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file exported from DeGiro.');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      setError(null);
      onFile(e.target?.result as string);
    };
    reader.onerror = () => setError('Could not read the file.');
    // DeGiro exports UTF-8; fall back gracefully for older exports
    reader.readAsText(file, 'utf-8');
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) read(file);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'border-2 border-dashed rounded-xl p-16 text-center cursor-pointer',
        'transition-colors select-none',
        dragging
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30',
      ].join(' ')}
      onClick={() => inputRef.current?.click()}
      onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) read(file);
          // Reset so the same file can be re-uploaded after a parse error
          e.target.value = '';
        }}
      />

      <div className="text-5xl mb-4" aria-hidden>📂</div>
      <p className="font-semibold text-lg">Drop your DeGiro CSV here</p>
      <p className="text-sm text-muted-foreground mt-1">or click to browse</p>

      {error && (
        <p className="text-destructive text-sm mt-4 font-medium">{error}</p>
      )}
    </div>
  );
}
