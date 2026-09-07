import { useImperativeHandle, useState, type ReactNode, type Ref } from "react";
import { Extension, type CommandProps, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import {
	Baseline,
	Bold,
	Italic,
	Link2,
	List,
	ListIndentDecrease,
	ListIndentIncrease,
	ListOrdered,
	RemoveFormatting,
	Strikethrough,
	TextAlignCenter,
	TextAlignJustify,
	TextAlignStart,
	TextAlignEnd,
	TextQuote,
	Underline,
} from "lucide-react";
import { Button } from "@/client/components/app/button";
import { Choice } from "@/client/components/app/choice";
import {
	Input,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/client/components/ui";
import { cn } from "@/client/lib/utils";

/**
 * The composer's body: a rich-text editor with the toolbar a mail client is
 * expected to have.
 *
 * Everything here is aimed at what survives the trip. The fonts are the
 * web-safe families a recipient's client can actually resolve — not the brand
 * face, which exists on this deployment and nowhere else — and sizes and
 * colours are written as inline styles, because a `<style>` block is the first
 * thing a mail client strips.
 */

/** Web-safe, in the stacks a recipient's client can resolve. */
const FONTS = [
	{ value: "sans", label: "Sans Serif", stack: "Arial, Helvetica, sans-serif" },
	{ value: "serif", label: "Serif", stack: "Georgia, 'Times New Roman', serif" },
	{ value: "mono", label: "Fixed width", stack: "'Courier New', Courier, monospace" },
] as const;

/** Absolute, because `em` compounds against whatever the reading client sets. */
const SIZES = [
	{ value: "12px", label: "Small" },
	{ value: "14px", label: "Normal" },
	{ value: "18px", label: "Large" },
	{ value: "26px", label: "Huge" },
] as const;

const DEFAULT_SIZE = "14px";

/** Fixed hex, never a token: the recipient's client has none of our variables. */
const COLORS = [
	"#000000",
	"#434343",
	"#666666",
	"#999999",
	"#b7b7b7",
	"#ffffff",
	"#980000",
	"#ff0000",
	"#ff9900",
	"#ffff00",
	"#00ff00",
	"#00ffff",
	"#4a86e8",
	"#0000ff",
	"#9900ff",
	"#ff00ff",
	"#e6b8af",
	"#fce5cd",
	"#d9ead3",
	"#c9daf8",
	"#cfe2f3",
	"#d9d2e9",
	"#a61c00",
	"#bf9000",
	"#38761d",
	"#1155cc",
	"#351c75",
	"#741b47",
];

const INDENT_STEP = 40;
const MAX_INDENT = INDENT_STEP * 8;

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		indent: {
			indent: () => ReturnType;
			outdent: () => ReturnType;
		};
	}
}

/**
 * Indent as a margin on the block, which is how every mail client renders it.
 * ProseMirror has no indent of its own — its own answer is list nesting, and
 * that only covers the case where the caret is already in a list.
 */
const Indent = Extension.create({
	name: "indent",

	addOptions() {
		return { types: ["paragraph", "blockquote"] };
	},

	addGlobalAttributes() {
		return [
			{
				types: this.options.types,
				attributes: {
					indent: {
						default: 0,
						parseHTML: (element) => Number.parseInt(element.style.marginLeft, 10) || 0,
						renderHTML: (attributes) =>
							attributes.indent ? { style: `margin-left:${attributes.indent}px` } : {},
					},
				},
			},
		];
	},

	addCommands() {
		const types = this.options.types as string[];

		const shift =
			(direction: 1 | -1) =>
			() =>
			({ state, tr, dispatch }: CommandProps) => {
				const { from, to } = state.selection;
				let changed = false;

				state.doc.nodesBetween(from, to, (node: ProseMirrorNode, pos: number) => {
					if (!types.includes(node.type.name)) return;
					const current: number = node.attrs.indent ?? 0;
					const next = Math.min(MAX_INDENT, Math.max(0, current + direction * INDENT_STEP));
					if (next === current) return;
					tr.setNodeAttribute(pos, "indent", next);
					changed = true;
				});

				if (changed && dispatch) dispatch(tr);
				return changed;
			};

		return { indent: shift(1), outdent: shift(-1) };
	},
});

export type RichTextHandle = {
	/** The caret above a quoted original, which is where a reply is written. */
	focusStart(): void;
	/** The `text/plain` part, taken from the document rather than re-derived. */
	getText(): string;
	/** Puts a block above whatever is already written, keeping the rest intact. */
	prepend(html: string): void;
};

/*
 * The document's own styling. Tailwind reaches inside because the editor renders
 * plain HTML, and this is the one place the app dresses markup it did not write.
 */
const CONTENT_CLASS = cn(
	"min-h-40 px-1 py-4 text-sm leading-relaxed outline-none",
	"[&_p]:my-2 [&_p:first-child]:mt-0",
	"[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
	"[&_li>p]:my-0",
	"[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
	"[&_a]:text-[var(--primary)] [&_a]:underline",
	"[&_hr]:my-4 [&_hr]:border-border",
	// Placeholder: Tiptap only marks the empty node, the text is drawn here.
	"[&_.is-editor-empty:first-child]:before:pointer-events-none",
	"[&_.is-editor-empty:first-child]:before:float-left",
	"[&_.is-editor-empty:first-child]:before:h-0",
	"[&_.is-editor-empty:first-child]:before:text-muted-foreground",
	"[&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
);

export function RichTextEditor({
	initialHtml,
	onChange,
	placeholder,
	ariaLabel,
	handleRef,
	className,
}: {
	initialHtml: string;
	onChange: (html: string) => void;
	placeholder?: string;
	ariaLabel: string;
	handleRef?: Ref<RichTextHandle>;
	className?: string;
}) {
	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				// Mail has no document outline; the size dropdown covers emphasis.
				heading: false,
				codeBlock: false,
				horizontalRule: false,
				link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noreferrer" } },
			}),
			TextStyle,
			FontFamily,
			FontSize,
			Color,
			TextAlign.configure({ types: ["paragraph"] }),
			Indent,
			Placeholder.configure({ placeholder: placeholder ?? "" }),
		],
		content: initialHtml,
		editorProps: {
			attributes: { class: CONTENT_CLASS, "aria-label": ariaLabel, role: "textbox" },
		},
		onUpdate: ({ editor: instance }) => {
			// An empty document still serialises to `<p></p>`; the caller wants
			// nothing, so the draft it saves stays empty.
			onChange(instance.isEmpty ? "" : instance.getHTML());
		},
	});

	useImperativeHandle(
		handleRef,
		() => ({
			focusStart: () => editor?.chain().focus("start").run(),
			getText: () => editor?.getText({ blockSeparator: "\n" }) ?? "",
			prepend: (html: string) => {
				editor?.chain().focus("start").insertContentAt(0, html).run();
			},
		}),
		[editor],
	);

	if (!editor) return null;

	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			{/* Clicking the empty space below the last line puts the caret in the
			    document, the way a textarea's whole box is the field. */}
			<div
				className="min-h-0 flex-1 cursor-text overflow-y-auto"
				onMouseDown={(event) => {
					if (event.target === event.currentTarget) editor.chain().focus("end").run();
				}}
			>
				<EditorContent editor={editor} />
			</div>
			<Toolbar editor={editor} />
		</div>
	);
}

/** One reading of the editor per transaction, shared by every control. */
function useToolbarState(editor: Editor) {
	return useEditorState({
		editor,
		selector: ({ editor: instance }) => ({
			bold: instance.isActive("bold"),
			italic: instance.isActive("italic"),
			underline: instance.isActive("underline"),
			strike: instance.isActive("strike"),
			bulletList: instance.isActive("bulletList"),
			orderedList: instance.isActive("orderedList"),
			blockquote: instance.isActive("blockquote"),
			link: instance.isActive("link"),
			align: instance.isActive({ textAlign: "center" })
				? "center"
				: instance.isActive({ textAlign: "right" })
					? "right"
					: instance.isActive({ textAlign: "justify" })
						? "justify"
						: "left",
			fontFamily: (instance.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
			fontSize: (instance.getAttributes("textStyle").fontSize as string | undefined) ?? "",
			href: (instance.getAttributes("link").href as string | undefined) ?? "",
		}),
	});
}

function Toolbar({ editor }: { editor: Editor }) {
	const state = useToolbarState(editor);

	const font = FONTS.find((entry) => entry.stack === state.fontFamily)?.value ?? FONTS[0].value;
	const size = SIZES.find((entry) => entry.value === state.fontSize)?.value ?? DEFAULT_SIZE;

	/* Indent means one more level of nesting inside a list, and a wider margin
	   everywhere else — the same key, the meaning the caret is standing in. */
	function shift(direction: 1 | -1) {
		const chain = editor.chain().focus();
		if (editor.isActive("listItem")) {
			if (direction === 1) chain.sinkListItem("listItem").run();
			else chain.liftListItem("listItem").run();
			return;
		}
		if (direction === 1) chain.indent().run();
		else chain.outdent().run();
	}

	return (
		<div className="flex flex-wrap items-center gap-0.5 border-t border-border py-1.5">
			<Choice
				value={font}
				aria-label="Font"
				size="sm"
				className="h-8 w-auto min-w-32 border-0 bg-transparent shadow-none dark:bg-transparent"
				options={FONTS.map((entry) => ({ value: entry.value, label: entry.label }))}
				onChange={(value) => {
					const stack = FONTS.find((entry) => entry.value === value)?.stack;
					if (stack) editor.chain().focus().setFontFamily(stack).run();
				}}
			/>

			<Choice
				value={size}
				aria-label="Size"
				size="sm"
				className="h-8 w-auto min-w-24 border-0 bg-transparent shadow-none dark:bg-transparent"
				options={SIZES.map((entry) => ({ value: entry.value, label: entry.label }))}
				onChange={(value) => editor.chain().focus().setFontSize(value).run()}
			/>

			<Divider />

			<ToolButton
				label="Bold (⌘B)"
				active={state.bold}
				onClick={() => editor.chain().focus().toggleBold().run()}
			>
				<Bold className="size-3.5" />
			</ToolButton>
			<ToolButton
				label="Italic (⌘I)"
				active={state.italic}
				onClick={() => editor.chain().focus().toggleItalic().run()}
			>
				<Italic className="size-3.5" />
			</ToolButton>
			<ToolButton
				label="Underline (⌘U)"
				active={state.underline}
				onClick={() => editor.chain().focus().toggleUnderline().run()}
			>
				<Underline className="size-3.5" />
			</ToolButton>
			<ToolButton
				label="Strikethrough"
				active={state.strike}
				onClick={() => editor.chain().focus().toggleStrike().run()}
			>
				<Strikethrough className="size-3.5" />
			</ToolButton>

			<ColorPicker editor={editor} />

			<Divider />

			<AlignMenu editor={editor} align={state.align} />

			<ToolButton
				label="Numbered list"
				active={state.orderedList}
				onClick={() => editor.chain().focus().toggleOrderedList().run()}
			>
				<ListOrdered className="size-3.5" />
			</ToolButton>
			<ToolButton
				label="Bulleted list"
				active={state.bulletList}
				onClick={() => editor.chain().focus().toggleBulletList().run()}
			>
				<List className="size-3.5" />
			</ToolButton>
			<ToolButton label="Decrease indent" onClick={() => shift(-1)}>
				<ListIndentDecrease className="size-3.5" />
			</ToolButton>
			<ToolButton label="Increase indent" onClick={() => shift(1)}>
				<ListIndentIncrease className="size-3.5" />
			</ToolButton>
			<ToolButton
				label="Quote"
				active={state.blockquote}
				onClick={() => editor.chain().focus().toggleBlockquote().run()}
			>
				<TextQuote className="size-3.5" />
			</ToolButton>

			<Divider />

			<LinkButton editor={editor} href={state.href} active={state.link} />

			<ToolButton
				label="Remove formatting"
				onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
			>
				<RemoveFormatting className="size-3.5" />
			</ToolButton>
		</div>
	);
}

function Divider() {
	return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/**
 * A toolbar button is an icon with a name: the label is the tooltip and the
 * accessible name at once, so nothing here depends on recognising a glyph.
 */
function ToolButton({
	label,
	active,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={label}
					aria-pressed={active}
					className={cn("size-8", active && "bg-[var(--pogpin-shell-fill-soft)] text-foreground")}
					onClick={onClick}
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

const ALIGNMENTS = [
	{ value: "left", label: "Align left", Icon: TextAlignStart },
	{ value: "center", label: "Align centre", Icon: TextAlignCenter },
	{ value: "right", label: "Align right", Icon: TextAlignEnd },
	{ value: "justify", label: "Justify", Icon: TextAlignJustify },
] as const;

function AlignMenu({ editor, align }: { editor: Editor; align: string }) {
	const [open, setOpen] = useState(false);
	const current = ALIGNMENTS.find((entry) => entry.value === align) ?? ALIGNMENTS[0];
	const Icon = current.Icon;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="Alignment"
					className="size-8"
				>
					<Icon className="size-3.5" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="flex w-auto gap-0.5 p-1" align="start">
				{ALIGNMENTS.map((entry) => (
					<Button
						key={entry.value}
						type="button"
						variant="ghost"
						size="icon"
						aria-label={entry.label}
						aria-pressed={entry.value === align}
						className={cn(
							"size-8",
							entry.value === align && "bg-[var(--pogpin-shell-fill-soft)] text-foreground",
						)}
						onClick={() => {
							editor.chain().focus().setTextAlign(entry.value).run();
							setOpen(false);
						}}
					>
						<entry.Icon className="size-3.5" />
					</Button>
				))}
			</PopoverContent>
		</Popover>
	);
}

function ColorPicker({ editor }: { editor: Editor }) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="Text colour"
					className="size-8"
				>
					<Baseline className="size-3.5" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-2" align="start">
				<div className="grid grid-cols-6 gap-1">
					{COLORS.map((color) => (
						<button
							key={color}
							type="button"
							aria-label={color}
							className="size-5 rounded-sm border border-border"
							style={{ backgroundColor: color }}
							onClick={() => {
								editor.chain().focus().setColor(color).run();
								setOpen(false);
							}}
						/>
					))}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="mt-2 w-full justify-start text-xs"
					onClick={() => {
						editor.chain().focus().unsetColor().run();
						setOpen(false);
					}}
				>
					Default colour
				</Button>
			</PopoverContent>
		</Popover>
	);
}

function LinkButton({
	editor,
	href,
	active,
}: {
	editor: Editor;
	href: string;
	active: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState(href);

	function apply() {
		const url = value.trim();
		const chain = editor.chain().focus().extendMarkRange("link");
		// A bare domain is what people paste; without a scheme the client treats
		// the href as a path on the recipient's own webmail.
		if (url) chain.setLink({ href: /^[a-z][\w+.-]*:/i.test(url) ? url : `https://${url}` }).run();
		else chain.unsetLink().run();
		setOpen(false);
	}

	return (
		<Popover
			open={open}
			// The field shows the link the caret is standing on, not the last one typed.
			onOpenChange={(next) => {
				if (next) setValue(href);
				setOpen(next);
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label="Link"
					aria-pressed={active}
					className={cn("size-8", active && "bg-[var(--pogpin-shell-fill-soft)] text-foreground")}
				>
					<Link2 className="size-3.5" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-2" align="start">
				<div className="flex items-center gap-2">
					<Input
						value={value}
						autoFocus
						placeholder="https://example.com"
						aria-label="Link address"
						className="machine h-8"
						onChange={(event) => setValue(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							// The composer sends on ⌘↵ and submits on ↵ nowhere else; this
							// Enter belongs to the field.
							event.preventDefault();
							event.stopPropagation();
							apply();
						}}
					/>
					<Button type="button" variant="secondary" size="sm" onClick={apply}>
						Apply
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
