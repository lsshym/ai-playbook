已按 align-contracts 处理提交边界。

修改了 [src/ProfileForm.tsx](/var/folders/vl/lc8s4rgd0jjgs6w9sq09624m0000gn/T/wingman-align-clean-workdirs/AC-10/skill-1/src/ProfileForm.tsx)：保留表单内部的 `firstName`/`lastName`，在 `handleSubmit` 提交 API 请求时生成接口要求的 `full_name`。

校验：尝试运行 `npx --yes tsc --noEmit --jsx react src/ProfileForm.tsx`，但当前环境无法访问 `registry.npmjs.org`，所以 TypeScript 编译检查未能完成。