# @dsh-std/storage

[English](README.md) | 中文

规范见 [Local Component Storage](../../docs/proposals/storage.zh.md)。

本包定义 Community v0.15 的 `storage.dsh/v1alpha1` `LocalStorage` 协议坐标、协商 definition、JSON 数据类型和操作校验器。具体存储后端与产品授权界面由实现提供。

rc1 的 get/set/delete profile 仍是基础能力。Consumer 可以显式协商 `presence` feature 以使用 `has`，或协商 `list` feature 以使用有界 cursor 分页；不能只根据 `v1alpha1` 坐标推定这些可选能力存在。
