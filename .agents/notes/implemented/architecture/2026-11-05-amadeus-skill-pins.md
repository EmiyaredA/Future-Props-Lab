# Agent Note: Amadeus 独立 Skill 固定版本

Status: implemented

## Problem

Amadeus 需要在独立状态目录固定对话实际加载的 Skill 版本，同时读取原 URL 下的嵌套文件并遵守 Integration 启用状态与账号隔离。

## Decision

Integration 在同账号 Skill 当前启用的前提下冻结其默认版本，流式返回长度与 SHA256。Identity 的私有委派绑定原加载请求和相同 Skill ID。Amadeus 在同卷暂存验证摘要、文件数和解压大小，安全展开，再次确认源可用后原子发布。已有固定版本只复核启用状态，仍读取自己保存的版本。网关与权限清单共用已发布 Skill 文件路径的匹配规则。

## Alternatives considered

复制 Integration 状态目录会交叉暴露凭据与其他账号资源。每次读取默认版本会改变历史对话已确认的工作材料。

## Consequences

更换默认版本只影响首次加载的对话。撤销启用阻止再次加载，已授权对话内既有快照可继续读回。二进制文件保持原字节，文本读取继续限制为 UTF-8 和 1 MiB。

## Verification

84 项定向隔离测试通过，1 项跳过。三服务测试覆盖未授权私有访问、不同 Skill ID 委派拒绝、Unicode 嵌套文件、旧版与新版对话的差异及禁用后的行为。
