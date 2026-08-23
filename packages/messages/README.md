# @dsh-std/messages

English | [中文](README.zh.md)

This package defines the Community v0.15 `messages.dsh/v1alpha1` `MessageObserver` coordinates, negotiation definition, event types, and validators for the ContentBlock text/image subset. Event sources, subscription dispatch, and authorization interfaces are supplied by implementations.

The rc1 envelope remains valid. Producers may additionally provide structured scope, correlation, redaction, payload schema, and envelope-version metadata; absence of `redactions` in a legacy event does not assert that no redaction occurred.
