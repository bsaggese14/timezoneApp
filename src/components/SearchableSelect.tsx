import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

interface SearchableSelectProps {
  id?: string;
  value: string;
  options: string[];
  onChange: (value: string, context?: { query: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  maxResults?: number;
  /** When set, adds a first option that selects an empty value. */
  emptyLabel?: string;
  /** Override default label substring matching (e.g. search cities → country). */
  matchOption?: (option: string, query: string) => boolean;
  /** Higher scores sort first when matchOption is used. */
  scoreOption?: (option: string, query: string) => number;
  /** Show an X button to clear the input and reset the filter. */
  clearable?: boolean;
  onClear?: () => void;
}

function optionLabel(option: string, emptyLabel?: string): string {
  return option === "" && emptyLabel ? emptyLabel : option;
}

function defaultMatchOption(
  option: string,
  query: string,
  emptyLabel?: string,
): boolean {
  const label = optionLabel(option, emptyLabel);
  const lower = label.toLowerCase();
  const q = query.trim().toLowerCase();
  return (
    lower === q || lower.startsWith(q) || lower.includes(q)
  );
}

function filterOptions(
  options: string[],
  query: string,
  limit: number,
  emptyLabel?: string,
  matchOption?: (option: string, query: string) => boolean,
  scoreOption?: (option: string, query: string) => number,
): string[] {
  const q = query.trim();
  if (!q) return options.slice(0, limit);

  const matches = (opt: string) =>
    matchOption
      ? matchOption(opt, q)
      : defaultMatchOption(opt, q, emptyLabel);

  if (scoreOption) {
    return options
      .map((opt) => ({ opt, score: scoreOption(opt, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.opt.localeCompare(b.opt))
      .map(({ opt }) => opt)
      .slice(0, limit);
  }

  const exact: string[] = [];
  const starts: string[] = [];
  const rest: string[] = [];

  for (const opt of options) {
    if (!matches(opt)) continue;
    const label = optionLabel(opt, emptyLabel).toLowerCase();
    const ql = q.toLowerCase();
    if (label === ql) exact.push(opt);
    else if (label.startsWith(ql)) starts.push(opt);
    else rest.push(opt);
  }

  return [...exact, ...starts, ...rest].slice(0, limit);
}

export function SearchableSelect({
  id: idProp,
  value,
  options,
  onChange,
  placeholder = "Search…",
  disabled = false,
  maxResults = 80,
  emptyLabel,
  matchOption,
  scoreOption,
  clearable = false,
  onClear,
}: SearchableSelectProps) {
  const generatedId = useId();
  const listboxId = `${idProp ?? generatedId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);

  const listOptions = useMemo(
    () => (emptyLabel ? ["", ...options] : options),
    [options, emptyLabel],
  );

  const filtered = useMemo(
    () =>
      filterOptions(
        listOptions,
        query,
        maxResults,
        emptyLabel,
        matchOption,
        scoreOption,
      ),
    [listOptions, query, maxResults, emptyLabel, matchOption, scoreOption],
  );

  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const selectOption = (option: string) => {
    onChange(option, { query });
    setQuery(option === "" ? "" : option);
    setOpen(false);
    inputRef.current?.blur();
  };

  const showClearButton =
    clearable && !disabled && (value !== "" || query.trim() !== "");

  const clearSearch = () => {
    setQuery("");
    setOpen(false);
    if (onClear) onClear();
    else onChange("", { query: "" });
    inputRef.current?.focus();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (open && filtered[activeIndex]) {
          selectOption(filtered[activeIndex]);
        } else if (filtered.length === 1) {
          selectOption(filtered[0]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setQuery(value);
        inputRef.current?.blur();
        break;
      case "Tab":
        setOpen(false);
        setQuery(value);
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      className={`searchable-select${open ? " searchable-select--open" : ""}`}
    >
      <div
        className={`searchable-select-input-wrap${showClearButton ? " searchable-select-input-wrap--clearable" : ""}`}
      >
        <input
          ref={inputRef}
          id={idProp ?? generatedId}
          type="text"
          className="searchable-select-input tz-search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && filtered[activeIndex]
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          onFocus={() => {
            setOpen(true);
            setQuery(value);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
        />
        {showClearButton && (
          <button
            type="button"
            className="searchable-select-clear"
            aria-label="Clear search"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearSearch}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      {open && !disabled && (
        <ul
          id={listboxId}
          className="searchable-select-list"
          role="listbox"
          aria-label="Options"
        >
          {filtered.length === 0 ? (
            <li className="searchable-select-empty" role="presentation">
              No matches
            </li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option === "" ? "__empty__" : option}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={option === value}
                className={`searchable-select-option${index === activeIndex ? " searchable-select-option--active" : ""}${option === value ? " searchable-select-option--selected" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(option)}
              >
                {optionLabel(option, emptyLabel)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
