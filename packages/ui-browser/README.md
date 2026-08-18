# @dsh-std/ui-browser

`@dsh-std/ui-browser` defines optional browser-realm surface coordinates and a same-page local-module ABI. It extends `@dsh-std/ui`; it does not identify an application as Web or Desktop.

Web clients, Electron renderers, and embedded browser shells may advertise these surfaces when they implement the exact ABI. Terminal and headless products need not implement this package.
