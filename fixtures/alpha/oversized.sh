#!/bin/sh
awk 'BEGIN { for (i=1; i<=200; i++) printf "synthetic passing check %04d ........................................................\n", i }'
