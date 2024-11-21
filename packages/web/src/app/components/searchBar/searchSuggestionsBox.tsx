'use client';

import { isDefined } from "@/lib/utils";
import { CommitIcon, MixerVerticalIcon } from "@radix-ui/react-icons";
import { IconProps } from "@radix-ui/react-icons/dist/types";
import assert from "assert";
import clsx from "clsx";
import escapeStringRegexp from "escape-string-regexp";
import Fuse from "fuse.js";
import { forwardRef, Ref, useEffect, useMemo, useState } from "react";
import {
    archivedModeSuggestions,
    caseModeSuggestions,
    forkModeSuggestions,
    publicModeSuggestions,
    refineModeSuggestions,
    suggestionModeMappings
} from "./constants";

type Icon = React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>>;

export type Suggestion = {
    value: string;
    description?: string;
    spotlight?: boolean;
}

export type SuggestionMode =
    "refine" |
    "archived" |
    "file" |
    "language" |
    "case" |
    "fork" |
    "public" |
    "revision" |
    "symbol" |
    "content" |
    "repo";

interface SearchSuggestionsBoxProps {
    query: string;
    onCompletion: (value: ((prevQuery: string) => { newQuery: string, newCursorPosition: number })) => void,
    isEnabled: boolean;
    cursorPosition: number;
    isFocused: boolean;
    onFocus: () => void;
    onBlur: () => void;
    onReturnFocus: () => void;

    data: {
        repos: Suggestion[];
        languages: Suggestion[];
    }
}

const SearchSuggestionsBox = forwardRef(({
    query,
    onCompletion,
    isEnabled,
    data,
    cursorPosition,
    isFocused,
    onFocus,
    onBlur,
    onReturnFocus,
}: SearchSuggestionsBoxProps, ref: Ref<HTMLDivElement>) => {

    const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0);

    const { suggestionQuery, suggestionMode } = useMemo<{ suggestionQuery?: string, suggestionMode?: SuggestionMode }>(() => {
        const { queryParts, cursorIndex } = splitQuery(query, " ", cursorPosition);
        if (queryParts.length === 0) {
            return {};
        }
        const part = queryParts[cursorIndex];

        // Check if the query part starts with one of the
        // prefixes. If it does, then we are in the corresponding
        // suggestion mode for that prefix.
        const suggestionMode = (() => {
            for (const mapping of suggestionModeMappings) {
                for (const prefix of mapping.prefixes) {
                    if (part.startsWith(prefix)) {
                        return mapping.suggestionMode;
                    }
                }
            }
        })();

        if (suggestionMode) {
            const index = part.indexOf(":");
            return {
                suggestionQuery: part.substring(index + 1),
                suggestionMode,
            }
        }
        
        // Default to the refine suggestion mode
        // if there was no match.
        return {
            suggestionQuery: part,
            suggestionMode: "refine",
        }
    }, [cursorPosition, query]);

    const { suggestions, isHighlightEnabled, Icon, onSuggestionClicked } = useMemo(() => {
        if (!isDefined(suggestionQuery) || !isDefined(suggestionMode)) {
            return {};
        }

        const createOnSuggestionClickedHandler = (params: { regexEscaped?: boolean, trailingSpace?: boolean } = {}) => {
            const {
                regexEscaped = false,
                trailingSpace = true
            } = params;

            return (value: string) => {
                onCompletion((prevQuery) => {
                    const { queryParts, cursorIndex } = splitQuery(prevQuery, " ", cursorPosition);

                    const start = queryParts.slice(0, cursorIndex).join(" ");
                    const end = queryParts.slice(cursorIndex + 1).join(" ");

                    let part = queryParts[cursorIndex];

                    // Remove whatever query we have in the suggestion so far (if any).
                    // For example, if our part is "repo:gith", then we want to remove "gith"
                    // from the part before we complete the suggestion.
                    if (suggestionQuery.length > 0) {
                        part = part.slice(0, -suggestionQuery.length);
                    }

                    if (regexEscaped) {
                        part = part + `^${escapeStringRegexp(value)}$`;
                    } else if (value.includes(" ")) {
                        part = part + `"${value}"`;
                    } else {
                        part = part + value;
                    }

                    // Add a trailing space if we are at the end of the query
                    if (trailingSpace && cursorIndex === queryParts.length - 1) {
                        part += " ";
                    }

                    let newQuery = [
                        ...(start.length > 0 ? [start] : []),
                        part,
                    ].join(" ");
                    const newCursorPosition = newQuery.length;

                    newQuery = [
                        newQuery,
                        ...(end.length > 0 ? [end] : []),
                    ].join(" ");

                    return {
                        newQuery,
                        newCursorPosition,
                    }
                });
            }
        }

        const {
            threshold = 0.5,
            limit = 10,
            list,
            isHighlightEnabled = false,
            isSpotlightEnabled = false,
            onSuggestionClicked,
            Icon,
        } = ((): {
            threshold?: number,
            limit?: number,
            list: Suggestion[],
            isHighlightEnabled?: boolean,
            isSpotlightEnabled?: boolean,
            onSuggestionClicked: (value: string) => void,
            Icon?: Icon
        } => {
            switch (suggestionMode) {
                case "public":
                    return {
                        list: publicModeSuggestions,
                        onSuggestionClicked: createOnSuggestionClickedHandler(),
                    }
                case "fork":
                    return {
                        list: forkModeSuggestions,
                        onSuggestionClicked: createOnSuggestionClickedHandler(),
                    }
                case "case":
                    return {
                        list: caseModeSuggestions,
                        onSuggestionClicked: createOnSuggestionClickedHandler(),
                    }
                case "archived":
                    return {
                        list: archivedModeSuggestions,
                        onSuggestionClicked: createOnSuggestionClickedHandler(),
                    }
                case "repo":
                    return {
                        list: data.repos,
                        Icon: CommitIcon,
                        onSuggestionClicked: createOnSuggestionClickedHandler({ regexEscaped: true }),
                    }
                case "language": {
                    return {
                        list: data.languages,
                        onSuggestionClicked: createOnSuggestionClickedHandler(),
                        isSpotlightEnabled: true,
                    }
                }
                case "refine":
                    return {
                        threshold: 0.1,
                        list: refineModeSuggestions,
                        isHighlightEnabled: true,
                        isSpotlightEnabled: true,
                        Icon: MixerVerticalIcon,
                        onSuggestionClicked: createOnSuggestionClickedHandler({ trailingSpace: false }),
                    }
                case "file":
                case "revision":
                case "content":
                case "symbol":
                    return {
                        list: [],
                        onSuggestionClicked: createOnSuggestionClickedHandler(),
                    }
            }
        })();

        const fuse = new Fuse(list, {
            threshold,
            keys: ['value'],
            isCaseSensitive: true,
        });

        const results = (() => {
            if (suggestionQuery.length === 0) {
                // If spotlight is enabled, get the suggestions that are
                // flagged to be surfaced.
                if (isSpotlightEnabled) {
                    const spotlightSuggestions = list.filter((suggestion) => suggestion.spotlight);
                    return spotlightSuggestions;

                    // Otherwise, just show the Nth first suggestions.
                } else {
                    return list.slice(0, limit);
                }
            }

            return fuse.search(suggestionQuery, {
                limit,
            }).map(result => result.item)
        })();

        return {
            suggestions: results,
            isHighlightEnabled,
            Icon,
            onSuggestionClicked,
        }

    }, [suggestionQuery, suggestionMode, onCompletion, cursorPosition, data.repos, data.languages]);

    // When the list of suggestions change, reset the highlight index
    useEffect(() => {
        setHighlightedSuggestionIndex(0);
    }, [suggestions]);

    const suggestionModeText = useMemo(() => {
        if (!suggestionMode) {
            return "";
        }
        switch (suggestionMode) {
            case "repo":
                return "Repositories";
            case "refine":
                return "Refine search"
            default:
                return "";
        }
    }, [suggestionMode]);

    if (
        !isEnabled ||
        !suggestions ||
        suggestions.length === 0
    ) {
        return null;
    }

    return (
        <div
            ref={ref}
            className="w-full absolute z-10 top-12 border rounded-md bg-background drop-shadow-2xl p-2"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.stopPropagation();
                    const value = suggestions[highlightedSuggestionIndex].value;
                    onSuggestionClicked(value);
                }

                if (e.key === 'ArrowUp') {
                    e.stopPropagation();
                    setHighlightedSuggestionIndex((curIndex) => {
                        return curIndex <= 0 ? suggestions.length - 1 : curIndex - 1;
                    });
                }

                if (e.key === 'ArrowDown') {
                    e.stopPropagation();
                    setHighlightedSuggestionIndex((curIndex) => {
                        return curIndex >= suggestions.length - 1 ? 0 : curIndex + 1;
                    });
                }

                if (e.key === 'Escape') {
                    e.stopPropagation();
                    onReturnFocus();
                }
            }}
            onFocus={onFocus}
            onBlur={onBlur}
        >
            <p className="text-muted-foreground text-sm mb-1">
                {suggestionModeText}
            </p>
            {suggestions.map((result, index) => (
                <div
                    key={index}
                    className={clsx("flex flex-row items-center font-mono text-sm hover:bg-muted rounded-md px-1 py-0.5 cursor-pointer", {
                        "bg-muted": isFocused && index === highlightedSuggestionIndex,
                    })}
                    tabIndex={-1}
                    onClick={() => {
                        onSuggestionClicked(result.value)
                    }}
                >
                    {Icon && (
                        <Icon className="w-3 h-3 mr-2" />
                    )}
                    <div className="flex flex-row items-center">
                        <span
                            className={clsx('mr-2 flex-none', {
                                "text-highlight": isHighlightEnabled
                            })}
                        >
                            {result.value}
                        </span>
                        {result.description && (
                            <span className="text-muted-foreground font-light">
                                {result.description}
                            </span>
                        )}
                    </div>
                </div>
            ))}
            {isFocused && (
                <div className="flex flex-row items-center justify-end mt-1">
                    <span className="text-muted-foreground text-xs">
                        Press <kbd className="font-mono text-xs font-bold">Enter</kbd> to select
                    </span>
                </div>
            )}
        </div>
    )
});

SearchSuggestionsBox.displayName = "SearchSuggestionsBox";
export { SearchSuggestionsBox };

const splitQuery = (query: string, seperator: string, cursorPos: number) => {
    const queryParts = [];
    let cursorIndex = 0;
    let accumulator = "";
    let isInQuoteCapture = false;

    for (let i = 0; i < query.length; i++) {
        if (i === cursorPos) {
            cursorIndex = queryParts.length;
        }

        if (query[i] === "\"") {
            isInQuoteCapture = !isInQuoteCapture;
        }

        if (!isInQuoteCapture && query[i] === seperator) {
            queryParts.push(accumulator);
            accumulator = "";
            continue;
        }

        accumulator += query[i];
    }
    queryParts.push(accumulator);

    // Edge case: if the cursor is at the end of the query, set the cursor index to the last query part
    if (cursorPos === query.length) {
        cursorIndex = queryParts.length - 1;
    }

    // @note: since we're guaranteed to have at least one query part, we can safely assume that the cursor position
    // will be within bounds.
    assert(cursorIndex >= 0 && cursorIndex < queryParts.length, "Cursor position is out of bounds");

    return {
        queryParts,
        cursorIndex
    }
}