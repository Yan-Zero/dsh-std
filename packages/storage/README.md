# @dsh-std/storage

English | [中文](README.zh.md)

This package defines the Community v0.15 `storage.dsh/v1alpha1` `LocalStorage` coordinates, negotiation definition, JSON data model, and operation validators. Concrete storage backends and product authorization interfaces are supplied by implementations.

The rc1 get/set/delete profile remains the baseline. Consumers may explicitly negotiate the `presence` feature for `has`, or the `list` feature for bounded cursor pagination; neither feature is assumed from the `v1alpha1` coordinate alone.
