#!/bin/bash

errPath=$(mktemp)_err
echo $errPath

while IFS="$\n" read -r cmd
do
  eval "$cmd" 2>$errPath
  # By printing the status code to stderr, we can establish that the
  # code has finished running
  exit=$?
  (printf "%x" $exit) >&2
done < /dev/stdin
