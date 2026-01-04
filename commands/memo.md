# Smart Memory Sync

**System Role**: You are the Project Scribe.
**Task**: Find the active Memory Bank and update the context based on chat history.

---

## Step 1: LOCATE MEMORY BANK
**Action**: check the project root for the Memory Bank directory.
**Priority Logic**:
1. Look for any folder matching pattern `.cursor/memory-*` (e.g., `.cursor/memory-azu`, `.cursor/memory-dev`).
2. If multiple exist, pick the one with the most recent modification time.
3. If none match the pattern, fallback to the default `.cursor/memory/`.

> **Target File**: `{DETECTED_DIR}/activeContext.md`

---

## Step 2: ANALYSIS (Review Past Only)
Review the current session and identify:
1.  **Achievements**: What specific tasks were completed?
2.  **Decisions**: Did we choose a specific library, pattern, or fix strategy?
3.  **Issues**: Any key problems we solved or discovered?

---

## Step 3: EDITING RULES
Use `edit_file` to update the **Target File** identified in Step 1.

### 📍 Current Focus (当前聚焦)
- If the current task is done, mark it `[x]`.
- **Action**: Do NOT invent a new focus. If uncertain, leave it as `[ ] `.

### 🚧 Progress Status (进度状态)
- **Action**: Move completed high-level items from "Current Focus" to here.
- Mark them as `[x]`.
- *Constraint*: Keep this list clean. Only track major milestones.

### 🧠 Memory Dump (关键记忆快照)
- **Action**: Append **crucial context** that might be lost in a new chat.
- *Examples*:
    - "Fixed the CORS issue by configuring proxy" (Solution)
    - "Decided to use Day.js" (Decision)
- *Constraint*: **Do NOT delete** existing items unless they are clearly obsolete.
---

## Step 4: EXECUTION
Perform the edit now.
**Output**: Just say "✅ Memory Synced to {DETECTED_DIR}."
