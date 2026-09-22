import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useI18n } from "../lib/i18n.jsx";
import TagChip from "./TagChip.jsx";

// Deretan chip tag; value = nama tag terpilih (null = semua)
export default function TagFilter({ value, onChange, monitors }) {
  const { t } = useI18n();
  const [tags, setTags] = useState([]);
  useEffect(() => { api("/tags").then(setTags).catch(() => {}); }, [monitors.length]);
  if (tags.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button onClick={() => onChange(null)} className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${!value ? "border-accent/60 bg-accent/15 text-accent" : "border-border text-muted hover:text-fg"}`}>
        {t("monitors.allTags")}
      </button>
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} active={value === tag.name} onClick={() => onChange(value === tag.name ? null : tag.name)} />
      ))}
    </div>
  );
}
