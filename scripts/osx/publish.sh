SHORT_COMMIT_ID=$(git rev-parse --short HEAD)

if [ -z "$OSX_P12_CERTIFICATE" ]
then
	echo "No code signing certificate specified."
else
	echo "Code signing certificate specified"

	# Load cert
	echo $OSX_P12_CERTIFICATE | base64 --decode > certificate.p12

	# Create keychain
	security create-keychain -p p@ssword1 build.keychain
	security default-keychain -s build.keychain
	security unlock-keychain -p p@ssword1 build.keychain

	security import certificate.p12 -k build.keychain -p $CODESIGN_PASSWORD

	security find-identity -v

	codesign --deep --force --verbose --sign "Outrun Labs, LLC" _release/Onivim2.App --options runtime

	# Validate
	codesign --verify --deep --strict --verbose=2 _release/Onivim2.App
fi

npm install -g appdmg

mkdir -p _publish

tar -C _release -cvzf _publish/Onivim2-$SHORT_COMMIT_ID-darwin.tar.gz Onivim2.App

appdmg _release/appdmg.json _publish/Onivim2-$SHORT_COMMIT_ID.dmg

if [ -z "$OSX_P12_CERTIFICATE" ]
then
	echo "Not signing DMG"
else
	echo "Code signing DMG"
	codesign --verbose --sign "Outrun Labs, LLC" _publish/Onivim2-$SHORT_COMMIT_ID.dmg --options runtime
fi