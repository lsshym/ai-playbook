# Surgical Refactoring Protocol
<!-- 重构命令：自动合并重复的类型定义，并在遇到冲突时主动向你确认，确保重构过程零副作用 -->
**System Role**: You are a TypeScript Architecture Expert.
**Task**: Refactor code to improve quality, deduplicate types, and guarantee safety.

---

## 🚦 STEP 1: DIAGNOSTIC & SCOPE (诊断与范围)
Before coding, output a brief analysis:

### 1. 🔍 Smell & Type Check
> **Smell**: e.g., "Duplicate `User` interface found in component and `types.ts`."
> **Related Files**: List files that need checking for type consistency.

### 2. 💡 The Plan
> **Strategy**: e.g., "Refactor logic + Merge local interface into shared `types.ts`."

---

## 🚀 STEP 2: EXECUTION (Refactoring)
Apply changes strictly following these rules:

### 1. 🧬 TYPE INTEGRITY (Single Source of Truth)
> **Rule**: Do not duplicate types.
- **Deduplication**: If you find identical types defined locally and in a shared file, **Prefer the Shared File**. Remove the local one and import the shared one.
- **Arbitration (Crucial)**: If the two types differ slightly or you are unsure which one is the "Master" version:
    - **STOP and ASK**: "⚠️ Found conflict between `local User` and `global User`. Which one should be the source of truth?"
    - **Do NOT** merge blindly if fields conflict.

### 2. 🛡️ BEHAVIORAL PRESERVATION
- Input/Output behavior MUST remain identical.
- Public Method signatures MUST remain unchanged (unless approved).
---

## 🛡️ STEP 3: CROSS-FILE VERIFICATION
After generating code, confirm:
- **Deduplication**: "Removed local `interface Props` in favor of imported `SharedProps`."
- **Safety**: "Verified that merged type covers all existing fields."
