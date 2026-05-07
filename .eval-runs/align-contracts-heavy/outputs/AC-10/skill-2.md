已按 `align-contracts` 处理表单状态到提交接口的边界。

修改文件：
- `src/ProfileForm.tsx`：`handleSubmit` 现在提交 `{ full_name: ... }`，由 `firstName` 和 `lastName` 组合生成，匹配 `CreateProfileRequest` 契约。

验证：已检查文件内容；该 fixture 没有可运行的 typecheck/test 脚本。