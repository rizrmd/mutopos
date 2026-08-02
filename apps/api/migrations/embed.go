// Package migrations embeds SQL schema files for the API migrate runner.
package migrations

import "embed"

// FS contains ordered *.sql migration files (e.g. 001_init.sql).
//
//go:embed *.sql
var FS embed.FS
