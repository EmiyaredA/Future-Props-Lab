import { useRef } from "react";
import { Upload } from "lucide-react";

export function SkinUpload({
  name,
  disabled,
  onUpload,
}: {
  name: string;
  disabled: boolean;
  onUpload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="dp-upload"
        disabled={disabled}
        aria-label={`为 ${name} 上传 PNG`}
        onClick={() => input.current?.click()}
      >
        <Upload size={13} /> 上传 PNG
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png"
        hidden
        disabled={disabled}
        aria-label={`选择 ${name} 的 PNG`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file && !disabled) onUpload(file);
        }}
      />
    </>
  );
}
