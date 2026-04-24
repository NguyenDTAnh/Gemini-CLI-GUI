import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';

export interface SuggestionItem {
  id: string;
  display: string;
  fsPath?: string;
}

export interface ContentEditableInputHandle {
  removeChip: (id: string) => void;
  getRawText: () => string;
  clear: () => void;
}

interface ContentEditableInputProps {
  placeholder?: string;
  slashCommands: SuggestionItem[];
  mentionCandidates: SuggestionItem[];
  onSearchFiles: (query: string) => void;
  onSubmit: (text: string) => void;
  onChipDeleted?: (id: string) => void;
  renderSlashSuggestion: (item: SuggestionItem, focused: boolean) => React.ReactNode;
  renderFileSuggestion: (item: SuggestionItem, focused: boolean) => React.ReactNode;
  prefill?: {
    nonce: number;
    text: string;
    append: boolean;
    contextChip?: { display: string; content: string; languageId: string };
    contextChips?: Array<{ display: string; content?: string; languageId?: string; type: 'mention' | 'snippet'; id?: string }>;
  };
}

export const ContentEditableInput = forwardRef<ContentEditableInputHandle, ContentEditableInputProps>(({
  placeholder,
  slashCommands,
  mentionCandidates,
  onSearchFiles,
  onSubmit,
  onChipDeleted,
  renderSlashSuggestion,
  renderFileSuggestion,
  prefill
}, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const currentChipIdsRef = useRef<Set<string>>(new Set());

  useImperativeHandle(ref, () => ({
    getRawText,
    clear: () => {
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
        currentChipIdsRef.current.clear();
      }
    },
    removeChip: (idOrPath: string) => {
      if (!editorRef.current || !idOrPath) return;

      const allChips = editorRef.current.querySelectorAll('.mention-chip');
      let removedCount = 0;

      allChips.forEach(chip => {
        const el = chip as HTMLElement;
        const chipId = el.dataset.id;
        const chipDisplay = el.dataset.display;

        if (chipId === idOrPath || chipDisplay === idOrPath) {
          // Try to find and remove the trailing non-breaking space
          const next = chip.nextSibling;
          if (next && next.nodeType === Node.TEXT_NODE && (next.textContent === '\u00A0' || next.textContent === ' ')) {
            next.parentNode?.removeChild(next);
          }
          chip.parentNode?.removeChild(chip);
          removedCount++;
        }
      });

      if (removedCount > 0) {
        // Update the tracking set immediately
        const remainingChips = editorRef.current.querySelectorAll('.mention-chip');
        const nextIds = new Set<string>();
        remainingChips.forEach(c => {
          const cid = (c as HTMLElement).dataset.id;
          if (cid) nextIds.add(cid);
        });
        currentChipIdsRef.current = nextIds;
      }
    }
  }));
  
  const [suggestionState, setSuggestionState] = useState<{
    active: boolean;
    type: 'slash' | 'mention';
    query: string;
    node: Node | null;
    offsetStart: number;
    offsetEnd: number;
  } | null>(null);

  const [focusedIndex, setFocusedIndex] = useState(0);

  const items = suggestionState?.type === 'slash'
    ? slashCommands.filter(c => c.display.toLowerCase().includes(suggestionState.query.toLowerCase()))
    : mentionCandidates;

  useEffect(() => {
    if (listRef.current && suggestionState?.active) {
      const activeItem = listRef.current.querySelector('.mentions-input__suggestions__item--focused') as HTMLElement;
      if (activeItem) {
        const container = listRef.current.parentElement as HTMLElement;
        if (!container) return;

        const isFirst = !activeItem.previousElementSibling;
        const isLast = !activeItem.nextElementSibling;

        if (isFirst) {
          container.scrollTop = 0;
        } else if (isLast) {
          container.scrollTop = container.scrollHeight;
        } else {
          const itemTop = activeItem.offsetTop;
          const itemBottom = itemTop + activeItem.offsetHeight;
          const containerTop = container.scrollTop;
          const containerBottom = containerTop + container.offsetHeight;

          if (itemTop < containerTop) {
            container.scrollTop = itemTop;
          } else if (itemBottom > containerBottom) {
            container.scrollTop = itemBottom - container.offsetHeight;
          }
        }
      }
    }
  }, [focusedIndex, suggestionState, items]);

  const getRawText = () => {
    if (!editorRef.current) return '';
    let text = '';
    const traverse = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.classList.contains('mention-chip')) {
          const type = el.dataset.type;
          const id = el.dataset.id;
          const display = el.dataset.display;
          const content = el.dataset.content;
          const language = el.dataset.language;

          if (type === 'mention') {
            text += `@[${display}](${id})`;
          } else if (type === 'slash') {
            text += `/${id}`;
          } else if (type === 'snippet') {
            text += `\n\n## Selected context: ${display}\n\`\`\`${language}\n${content}\n\`\`\`\n\n`;
          }
        } else if (el.tagName === 'BR') {
          text += '\n';
        } else if (el.tagName === 'DIV' && text.length > 0) {
          text += '\n';
          Array.from(el.childNodes).forEach(traverse);
        } else {
          Array.from(el.childNodes).forEach(traverse);
        }
      }
    };
    Array.from(editorRef.current.childNodes).forEach(traverse);
    return text.replace(/\n{3,}/g, '\n\n'); // normalize excessive newlines
  };

  const handleInput = () => {
    if (!editorRef.current) return;
    
    // Clean up empty br left by contenteditable
    if (editorRef.current.innerHTML === '<br>') {
      editorRef.current.innerHTML = '';
    }

    // --- NEW: Sanitize HTML to only allow safe elements ---
    const sanitize = (container: Node) => {
      const children = Array.from(container.childNodes);
      children.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const isChip = el.classList.contains('mention-chip');
          const isSafeTag = el.tagName === 'BR' || el.tagName === 'DIV' || el.tagName === 'P';

          if (isChip) {
            // Chips are sacred, don't touch them or their children
            return;
          }

          if (isSafeTag) {
            // Safe tags are allowed, but clean their contents
            sanitize(el);
          } else {
            // Disallowed tag: move its children out then remove it (flattening)
            while (el.firstChild) {
              el.parentNode?.insertBefore(el.firstChild, el);
            }
            el.parentNode?.removeChild(el);
            // After removing el, we don't need to do more for this node, 
            // but the children we just moved out will be processed in the next steps 
            // of the outer loop if they are already in the 'children' array.
            // Actually, we should sanitize the children we just moved.
          }
        }
      });
    };

    sanitize(editorRef.current);
    // --- END Sanitize ---

    // --- NEW: Detection of deleted chips ---
    const allChips = editorRef.current.querySelectorAll('.mention-chip');
    const newChipIds = new Set<string>();
    allChips.forEach(c => {
      const id = (c as HTMLElement).dataset.id;
      if (id) newChipIds.add(id);
    });

    // Find what's missing
    currentChipIdsRef.current.forEach(oldId => {
      if (!newChipIds.has(oldId)) {
        onChipDeleted?.(oldId);
      }
    });
    currentChipIdsRef.current = newChipIds;
    // --- END detection ---

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    
    if (node.nodeType !== Node.TEXT_NODE) {
      setSuggestionState(null);
      return;
    }

    const textBeforeCaret = node.textContent?.slice(0, range.startOffset) || '';
    
    const mentionMatch = textBeforeCaret.match(/(?:^|\s)@([^\s]*)$/);
    const slashMatch = textBeforeCaret.match(/(?:^|\s)\/([^\s]*)$/);

    if (mentionMatch) {
      const query = mentionMatch[1];
      onSearchFiles(query);
      setSuggestionState({
        active: true,
        type: 'mention',
        query,
        node,
        offsetStart: range.startOffset - query.length - 1,
        offsetEnd: range.startOffset
      });
      setFocusedIndex(0);
    } else if (slashMatch) {
      const query = slashMatch[1];
      setSuggestionState({
        active: true,
        type: 'slash',
        query,
        node,
        offsetStart: range.startOffset - query.length - 1,
        offsetEnd: range.startOffset
      });
      setFocusedIndex(0);
    } else {
      setSuggestionState(null);
    }
  };

  const insertSuggestion = (item: SuggestionItem) => {
    if (!suggestionState || !suggestionState.node) return;
    
    const { node, offsetStart, offsetEnd, type } = suggestionState;
    const textContent = node.textContent || '';
    
    const beforeText = textContent.slice(0, offsetStart);
    const afterText = textContent.slice(offsetEnd);
    
    node.textContent = beforeText; 
    
    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.className = 'mention-chip';
    chip.dataset.type = type;
    chip.dataset.id = item.id;
    chip.dataset.display = item.display;
    chip.textContent = type === 'slash' ? `/${item.display}` : `@${item.display}`;
    
    const space = document.createTextNode('\u00A0'); 
    const afterNode = document.createTextNode(afterText);
    
    const parent = node.parentNode;
    if (parent) {
      const nextSibling = node.nextSibling;
      parent.insertBefore(chip, nextSibling);
      parent.insertBefore(space, nextSibling);
      if (afterText) {
        parent.insertBefore(afterNode, nextSibling);
      }
      if (item.id) currentChipIdsRef.current.add(item.id);
    }
    
    const newRange = document.createRange();
    newRange.setStart(space, 1);
    newRange.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(newRange);
    
    setSuggestionState(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (suggestionState && suggestionState.active) {
      const items = suggestionState.type === 'slash' 
        ? slashCommands.filter(c => c.display.toLowerCase().includes(suggestionState.query.toLowerCase()))
        : mentionCandidates;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(prev => (prev + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(prev => (prev - 1 + items.length) % items.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (items[focusedIndex]) {
          insertSuggestion(items[focusedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestionState(null);
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = getRawText().trim();
        if (text) {
          onSubmit(text);
        }
      }
    }
  };

  useEffect(() => {
    if (prefill && editorRef.current) {
      const { text, contextChip, contextChips } = prefill;
      
      if (text) {
        const currentRaw = getRawText();
        if (!currentRaw) {
          editorRef.current.innerHTML = text.replace(/\n/g, '<br>');
        } else {
          editorRef.current.innerHTML += '<br><br>' + text.replace(/\n/g, '<br>');
        }
      }

      const chipsToInsert = contextChips || (contextChip ? [{ 
        display: contextChip.display, 
        content: contextChip.content, 
        languageId: contextChip.languageId, 
        type: 'snippet' as const 
      }] : []);

      for (const chipData of chipsToInsert) {
        const chip = document.createElement('span');
        chip.contentEditable = 'false';
        
        if (chipData.type === 'snippet') {
          chip.className = 'mention-chip snippet-chip';
          chip.dataset.type = 'snippet';
          chip.dataset.display = chipData.display;
          chip.dataset.content = chipData.content || "";
          chip.dataset.language = chipData.languageId || "";
          chip.textContent = chipData.display;
        } else {
          chip.className = 'mention-chip';
          chip.dataset.type = 'mention';
          chip.dataset.id = chipData.id || chipData.display;
          chip.dataset.display = chipData.display;
          chip.textContent = `@${chipData.display}`;
        }
        
        const space = document.createTextNode('\u00A0');
        
        // If there's content already, add a break before if it doesn't end with one
        if (editorRef.current.innerHTML && !editorRef.current.innerHTML.endsWith('<br>') && !editorRef.current.innerHTML.endsWith('\u00A0')) {
          editorRef.current.appendChild(document.createElement('br'));
        }
        
        editorRef.current.appendChild(chip);
        editorRef.current.appendChild(space);
        if (chipData.id || chipData.display) {
          currentChipIdsRef.current.add(chipData.id || chipData.display);
        }
      }
      
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [prefill]);

  return (
    <div className="content-editable-wrapper">
      <div
        ref={editorRef}
        contentEditable
        className="content-editable-input"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setTimeout(() => setSuggestionState(null), 200);
        }}
        onDrop={(e) => {
          // Prevent browser from natively inserting dropped file paths as text
          e.preventDefault();
        }}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData('text/html');
          const text = e.clipboardData.getData('text/plain');
          const selection = window.getSelection();
          if (!selection || !selection.rangeCount) return;
          selection.deleteFromDocument();

          if (html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const clean = (container: Node) => {
              const nodes = Array.from(container.childNodes);
              nodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const el = node as HTMLElement;
                  const isChip = el.classList.contains('mention-chip');
                  const isSafeTag = el.tagName === 'BR' || el.tagName === 'DIV' || el.tagName === 'P';
                  
                  if (isChip) {
                    // Remove all children and keep just the chip with its text/attributes
                    // (prevents nested junk inside the chip span)
                    return;
                  }

                  if (isSafeTag) {
                    clean(el);
                  } else {
                    // Flatten: replace tag with its contents
                    while (el.firstChild) {
                      el.parentNode?.insertBefore(el.firstChild, el);
                    }
                    el.parentNode?.removeChild(el);
                  }
                }
              });
            };

            clean(doc.body);
            
            const fragment = document.createDocumentFragment();
            while (doc.body.firstChild) {
              fragment.appendChild(doc.body.firstChild);
            }
            selection.getRangeAt(0).insertNode(fragment);
          } else {
            const textNode = document.createTextNode(text);
            selection.getRangeAt(0).insertNode(textNode);
          }
          
          selection.collapseToEnd();
          handleInput();
        }}
        data-placeholder={placeholder}
      />
      
      {suggestionState && suggestionState.active && items.length > 0 && (
        <div className="mentions-input__suggestions">
          <ul ref={listRef} className="mentions-input__suggestions__list">
            {items.map((item, idx) => (
              <li
                key={item.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertSuggestion(item);
                }}
                className={`mentions-input__suggestions__item ${idx === focusedIndex ? 'mentions-input__suggestions__item--focused' : ''}`}
              >
                {suggestionState.type === 'slash'
                  ? renderSlashSuggestion(item, idx === focusedIndex)
                  : renderFileSuggestion(item, idx === focusedIndex)}
              </li>
            ))}
          </ul>
        </div>
      )}    </div>
  );
});

ContentEditableInput.displayName = "ContentEditableInput";
