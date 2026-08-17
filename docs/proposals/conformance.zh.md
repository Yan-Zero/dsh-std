# Conformance 与验证设计提案

- 文档类型：设计提案
- 状态：探索性草案
- 日期：2026-08-16

## Summary

本提案定义 DSH Standard 实现如何产生机器可读验证报告，以及各协议如何发布跨实现的一致性测试材料。

验证目标是说明“哪个实现的哪个版本通过了哪份协议的哪些检查”。包名、发布位置或维护者身份不能代替可复查的协议测试结果。

## Motivation

Manifest schema 校验只能发现字段错误，无法证明协商算法、状态机、清理或 wire 行为一致。CI 和实现者还需要区分：

- 文档可以被解析；
- 静态声明与协议 schema 相符；
- 参考 test vectors 得到预期结果；
- 运行实现通过行为测试；
- 产品 adapter 正确映射其内部 API。

统一报告格式使这些结果可以被复查，而不是只有一个模糊的“已验证”标记。

## Guide-level explanation

每份协议发布 conformance manifest，列出规范版本、测试套件、test vectors 和适用角色。实现选择自己声明的角色运行测试，产生 `ConformanceReport`。

报告包含 runner、implementation、环境、协议版本、suite digest、每项测试结果和未运行原因。报告必须保留签发者和时间，使调用方能够自行决定信任方式。

## Reference-level explanation

### Test layers

协议可以提供以下测试层：

- `schema`：合法/非法对象 fixtures；
- `negotiation`：声明、policy 与预期 agreement/issue；
- `state-machine`：输入序列与预期状态变化；
- `wire`：canonical encoding、frame 与错误处理；
- `behavior`：通过协议 API 运行的黑盒场景；
- `adapter`：产品内部对象与标准对象的双向映射。

并非所有协议都需要全部层。Suite 明确自己覆盖的层和 participant role。

### Report

机器报告至少包含：

- report schema version；
- protocol `apiVersion` 与 `kind`；
- suite id、version 和 content digest；
- runner id/version；
- implementation name/version/role；
- 与结果相关的环境属性；
- pass、fail、skip 与 not-applicable 列表；
- 每个 failure 的稳定 code、case id 和安全错误信息；
- 开始/结束时间与可选签名。

`skip` 不能计入通过率。实现只声称某个 optional role 或 feature 时，suite 才把对应 case 纳入适用集合。

### Deterministic vectors

Core、composition 与 connection 等确定性算法发布纯数据 vectors。任何语言实现都可以读取相同输入，并比较 canonical output 或 digest。

Test vector 不依赖 npm module 执行。Reference implementation 可以帮助生成和调试，但不是规范结果的唯一权威来源。

### Behavioral harness

Behavior suite 通过协议定义的公开 attachment/client 运行，不读取实现内部 registry。Runner 可以启动进程内 fixture、子进程或远端 endpoint。

需要凭据、付费服务或真实用户账号的测试必须单独标记，不能成为默认 conformance 的隐藏前提。

协议升级或 suite digest 改变后，旧报告仍可查阅，但不表示新版本通过。

## Security considerations

Runner 把被测实现视为不可信代码，使用隔离目录、受限凭据、网络 policy 和资源上限。

Report 不包含 secrets、完整路径、用户内容或未清理 stack。签名只证明某个主体签发该报告，不证明测试环境本身可信。

## Drawbacks

维护跨语言 fixtures 与行为 harness 会增加每份协议的发布成本。缺少真实实现时，过早固定测试可能固化错误设计。

自测、CI 和独立测试方的信任等级不同，标准报告不定义治理或认证 policy。

## Unresolved questions

### Report package

报告 schema 与 runner helpers 是否发布为 `@dsh-std/conformance`，待首个 core/connection suite 验证后决定。
