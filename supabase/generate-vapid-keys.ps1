$curve = [System.Security.Cryptography.ECCurve]::NamedCurves.nistP256
$ecdsa = [System.Security.Cryptography.ECDsa]::Create($curve)
$parameters = $ecdsa.ExportParameters($true)

function ConvertTo-Base64Url([byte[]]$bytes) {
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

[byte[]]$publicBytes = @(4) + $parameters.Q.X + $parameters.Q.Y

Write-Output "VAPID_PUBLIC_KEY=$(ConvertTo-Base64Url $publicBytes)"
Write-Output "VAPID_PRIVATE_KEY=$(ConvertTo-Base64Url $parameters.D)"

$ecdsa.Dispose()
