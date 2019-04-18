#!/bin/bash

errPath=$(mktemp)_err
inPath=$(mktemp)_in
mkfifo -m 600 "$inPath"
echo $errPath
echo $inPath

while IFS='$\n' read -r cmd
do
  # cleanup eventual error output
  rm -f "$errPath"
  eval "$cmd" 2>$errPath
  # By printing the status code to stderr, we can establish that th
  # code has finished running
  exit=$?
  # echo "${cmd} ... ${exit}" >&2
  (printf "%x" $exit) >&2
done < "$inPath"
